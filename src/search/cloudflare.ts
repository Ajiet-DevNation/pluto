/**
 * Cloudflare Workers AI clients for the two P2 operations:
 * embeddings (bge-base-en-v1.5) and grounded generation (llama-3.1-8b).
 *
 * The API responses are parsed defensively: a missing/odd shape must fail
 * closed rather than silently produce a zero vector or an empty answer.
 */

import type { AnswerGenerator, EmbeddingClient } from './types';
import { fetchWithRetry } from '../http/retry';

export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBEDDING_DIMENSIONS = 768;
export const GENERATION_MODEL = '@cf/meta/llama-3.1-8b-instruct';
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
    );

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

export class CloudflareAnswerGenerator implements AnswerGenerator {
  private readonly fetchImpl: typeof fetch;

  private readonly credentials: CloudflareCredentials;

  constructor(options: CloudflareClientOptions) {
    this.credentials = requireCredentials(options);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(prompt: string): Promise<string> {
    if (!prompt.trim()) {
      throw new CloudflareAIError('Cannot generate an answer from an empty prompt');
    }

    const response = await fetchWithRetry(this.fetchImpl,
      endpoint(this.credentials.accountId, GENERATION_MODEL),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content:
                'You are Pluto, a project assistant. Answer only from the supplied evidence. ' +
                'If the evidence does not answer the question, say that you cannot find evidence. ' +
                'Never use outside knowledge. Cite evidence items as [1], [2], etc.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      },
    );

    const payload = await readJson(response);
    if (!response.ok) {
      throw new CloudflareAIError(
        `Generation request failed (${response.status}): ${JSON.stringify(payload).slice(0, 200)}`,
      );
    }

    const result = (payload as { result?: unknown }).result;
    const text =
      typeof result === 'string'
        ? result
        : (result as { response?: unknown } | undefined)?.response;

    if (typeof text !== 'string' || !text.trim()) {
      throw new CloudflareAIError('Generation response did not contain an answer');
    }
    return text.trim();
  }
}
