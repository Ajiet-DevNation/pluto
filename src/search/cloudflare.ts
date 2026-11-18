/**
 * Cloudflare Workers AI embedding client for indexing.
 *
 * `/ask` answer generation was removed from active v1 on 2026-11-18. Responses
 * are parsed defensively: a missing/odd shape must fail closed rather than
 * silently produce a zero vector.
 */

import type { EmbeddingClient } from './types';
import { fetchWithRetry } from '../http/retry';
import { EmbeddingQuotaExceededError, nextUtcDay } from './embedding-errors';

export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBEDDING_DIMENSIONS = 768;
export const CLOUDFLARE_AI_BASE = 'https://api.cloudflare.com/client/v4/accounts';

export class CloudflareAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareAIError';
  }
}

export interface CloudflareCredentials {
  accountId: string;
  token: string;
}

export interface CloudflareClientOptions extends CloudflareCredentials {
  fetchImpl?: typeof fetch;
}

function requireCredentials(options: CloudflareClientOptions): CloudflareCredentials {
  const accountId = options.accountId.trim();
  const token = options.token.trim();
  if (!accountId) {
    throw new CloudflareAIError('CLOUDFLARE_ACCOUNT_ID is not set');
  }
  if (!token) {
    throw new CloudflareAIError('CLOUDFLARE_AI_TOKEN is not set');
  }
  return { accountId, token };
}

function endpoint(accountId: string, model: string): string {
  return `${CLOUDFLARE_AI_BASE}/${accountId}/ai/run/${model}`;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new CloudflareAIError(
      `Cloudflare AI returned non-JSON (${response.status}): ${body.slice(0, 200)}`,
    );
  }
}

export class CloudflareEmbeddingClient implements EmbeddingClient {
  private readonly fetchImpl: typeof fetch;

  private readonly credentials: CloudflareCredentials;

  constructor(options: CloudflareClientOptions) {
    this.credentials = requireCredentials(options);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    if (texts.some((text) => typeof text !== 'string' || !text.trim())) {
      throw new CloudflareAIError('Cannot embed an empty text');
    }

    const response = await fetchWithRetry(this.fetchImpl,
      endpoint(this.credentials.accountId, EMBEDDING_MODEL),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: texts }),
      },
      // A 429 can mean the daily free neuron allocation is exhausted. Retrying
      // it immediately only burns requests; the indexer persists a deferral.
      { retryableStatus: (candidate) => [500, 502, 503, 504].includes(candidate.status) },
    );

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterMs = retryAfter
        ? (Number.isFinite(Number(retryAfter))
          ? Number(retryAfter) * 1000
          : Date.parse(retryAfter) - Date.now())
        : 0;
      const resumeAt = retryAfterMs > 0
        ? new Date(Date.now() + retryAfterMs)
        : nextUtcDay();
      throw new EmbeddingQuotaExceededError(
        resumeAt,
        `Cloudflare embedding quota/rate limit reached; resume after ${resumeAt.toISOString()}`,
      );
    }
    const payload = await readJson(response);
    if (!response.ok) {
      throw new CloudflareAIError(
        `Embedding request failed (${response.status}): ${JSON.stringify(payload).slice(0, 200)}`,
      );
    }

    const result = (payload as { result?: unknown }).result;
    const data = Array.isArray(result)
      ? result
      : (result as { data?: unknown } | undefined)?.data;

    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new CloudflareAIError('Embedding response did not contain one vector per input');
    }

    return data.map((vector, index) => {
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new CloudflareAIError(
          `Embedding ${index} did not have the required ${EMBEDDING_DIMENSIONS} dimensions`,
        );
      }
      const numbers = vector.map((value) => Number(value));
      if (numbers.some((value) => !Number.isFinite(value))) {
        throw new CloudflareAIError(`Embedding ${index} contained a non-finite value`);
      }
      return numbers;
    });
  }
}
