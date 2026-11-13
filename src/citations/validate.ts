import { CitationError } from './types';

export function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CitationError(`Invalid ${label}: value is empty`);
  }
  return value.trim();
}

export function requirePattern(value: string, pattern: RegExp, label: string): string {
  const trimmed = requireNonEmpty(value, label);
  if (!pattern.test(trimmed)) {
    throw new CitationError(`Invalid ${label}: "${trimmed}"`);
  }
  return trimmed;
}

export function requirePositiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CitationError(`Invalid ${label}: ${value}`);
  }
  return value;
}

export function requireHttpUrl(value: string, label: string): string {
  const trimmed = requireNonEmpty(value, label);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CitationError(`Invalid ${label}: not a URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CitationError(`Invalid ${label}: expected an http(s) URL`);
  }
  return trimmed;
}
