import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../../src/http/retry';

test('retries a transient ECONNRESET and then returns the response', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    return new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;

  const response = await fetchWithRetry(fetchImpl, 'https://example.com', { method: 'GET' });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('retries retryable server responses but returns client errors immediately', async () => {
  let serverCalls = 0;
  const serverFetch = (async () => {
    serverCalls += 1;
    return serverCalls === 1
      ? new Response('temporary', { status: 503 })
      : new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;
  const serverResponse = await fetchWithRetry(serverFetch, 'https://example.com', { method: 'GET' });
  assert.equal(serverResponse.status, 200);
  assert.equal(serverCalls, 2);

  let clientCalls = 0;
  const clientFetch = (async () => {
    clientCalls += 1;
    return new Response('unauthorized', { status: 401 });
  }) as unknown as typeof fetch;
  const clientResponse = await fetchWithRetry(clientFetch, 'https://example.com', { method: 'GET' });
  assert.equal(clientResponse.status, 401);
  assert.equal(clientCalls, 1);
});
