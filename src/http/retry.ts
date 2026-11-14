export interface FetchRetryOptions {
  maxAttempts?: number;
  retryableStatus?: (response: Response) => boolean;
}

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  const cause = candidate.cause && typeof candidate.cause === 'object'
    ? candidate.cause as { code?: unknown }
    : undefined;
  const code = typeof candidate.code === 'string'
    ? candidate.code
    : typeof cause?.code === 'string'
      ? cause.code
      : '';
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code);
}

function retryableStatus(response: Response): boolean {
  return response.status === 429 ||
    response.status === 500 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504;
}

function delayFor(response: Response | undefined, retryNumber: number): number {
  if (response) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const fromSeconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(fromSeconds) && fromSeconds > 0) return Math.min(fromSeconds, 30_000);
    }
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
      const untilReset = resetSeconds * 1000 - Date.now();
      if (Number.isFinite(untilReset) && untilReset > 0) return Math.min(untilReset, 30_000);
    }
  }
  return Math.min(250 * 2 ** retryNumber, 4_000);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transient transport failures and rate/server responses a bounded number of times. */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 4;
  const shouldRetryResponse = options.retryableStatus ?? retryableStatus;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt + 1 >= maxAttempts) {
        throw error;
      }
    }

    if (response && (!shouldRetryResponse(response) || attempt + 1 >= maxAttempts)) {
      return response;
    }
    if (attempt + 1 < maxAttempts) {
      await wait(delayFor(response, attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('HTTP request failed after retries');
}
