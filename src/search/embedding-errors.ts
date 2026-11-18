export class EmbeddingDeferredError extends Error {
  constructor(
    message: string,
    readonly resumeAt: Date,
    readonly reason: 'run-budget' | 'daily-budget' | 'provider-quota',
  ) {
    super(message);
    this.name = 'EmbeddingDeferredError';
  }
}

export class EmbeddingQuotaExceededError extends Error {
  constructor(readonly resumeAt: Date, message: string) {
    super(message);
    this.name = 'EmbeddingQuotaExceededError';
  }
}

export function nextUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
