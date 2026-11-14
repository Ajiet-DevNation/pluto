import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudflareAIError,
  CloudflareAnswerGenerator,
  CloudflareEmbeddingClient,
  EMBEDDING_DIMENSIONS,
} from '../../src/search/cloudflare';
import { EmbeddingQuotaExceededError } from '../../src/search/embedding-errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureFetch(response: Response): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

test('embedding client calls bge-base-en-v1.5 with every input text', async () => {
  const { fetch, calls } = captureFetch(
    jsonResponse({
      result: {
        data: [
          Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1),
          Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.2),
        ],
      },
    }),
  );
  const client = new CloudflareEmbeddingClient({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  const vectors = await client.embed(['first', 'second']);

  assert.equal(vectors.length, 2);
  assert.equal(vectors[0].length, EMBEDDING_DIMENSIONS);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/baai/bge-base-en-v1.5',
  );
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    'Bearer token',
  );
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { text: ['first', 'second'] });
});

test('embedding client accepts a direct result array', async () => {
  const { fetch } = captureFetch(
    jsonResponse({
      result: [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.3)],
    }),
  );
  const client = new CloudflareEmbeddingClient({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  const [vector] = await client.embed(['one']);
  assert.equal(vector.length, EMBEDDING_DIMENSIONS);
});

test('embedding client fails closed on wrong dimensions', async () => {
  const { fetch } = captureFetch(jsonResponse({ result: { data: [[0.1, 0.2]] } }));
  const client = new CloudflareEmbeddingClient({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.embed(['one']), CloudflareAIError);
});

test('embedding client rejects empty input before calling the API', async () => {
  const { fetch, calls } = captureFetch(jsonResponse({ result: { data: [] } }));
  const client = new CloudflareEmbeddingClient({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  assert.deepEqual(await client.embed([]), []);
  await assert.rejects(() => client.embed(['  ']), CloudflareAIError);
  assert.equal(calls.length, 0);
});

test('embedding client surfaces non-2xx responses', async () => {
  const { fetch } = captureFetch(jsonResponse({ errors: ['nope'] }, 500));
  const client = new CloudflareEmbeddingClient({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  await assert.rejects(() => client.embed(['one']), /Embedding request failed \(500\)/);
});

test('embedding client treats 429 as a deferred quota condition without retrying', async () => {
  const { fetch, calls } = captureFetch(jsonResponse({
    errors: [{ message: 'daily free allocation exhausted' }],
  }, 429));
  const client = new CloudflareEmbeddingClient({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  await assert.rejects(
    () => client.embed(['one']),
    (error: unknown) => error instanceof EmbeddingQuotaExceededError && error.resumeAt > new Date(),
  );
  assert.equal(calls.length, 1);
});

test('answer generator sends a system instruction and returns the response', async () => {
  const { fetch, calls } = captureFetch(
    jsonResponse({ result: { response: 'The answer is grounded in [1].' } }),
  );
  const generator = new CloudflareAnswerGenerator({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  const answer = await generator.generate('Question: what?\n\nEvidence:\n[1] ...');

  assert.equal(answer, 'The answer is grounded in [1].');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /@cf\/meta\/llama-3.1-8b-instruct$/);
  const body = JSON.parse(String(calls[0].init?.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /only from the supplied evidence/i);
  assert.equal(body.messages[1].role, 'user');
});

test('answer generator fails closed on an empty answer', async () => {
  const { fetch } = captureFetch(jsonResponse({ result: { response: '   ' } }));
  const generator = new CloudflareAnswerGenerator({
    accountId: 'account',
    token: 'token',
    fetchImpl: fetch,
  });

  await assert.rejects(() => generator.generate('prompt'), CloudflareAIError);
});
