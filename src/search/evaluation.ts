/**
 * Evaluation-only matching helpers.
 *
 * These helpers make the acceptance checks semantic enough to reject the
 * wording-only false positives found in review:
 * - a confident current-version claim is not "uncertainty" merely because it
 *   mentions commit history;
 * - a version expectation is not satisfied by a negated or different version.
 *
 * They are intentionally conservative and are used by the evaluation runner and
 * its regression tests, not by the `/ask` runtime.
 */

export interface VersionExpectation {
  technology: string;
  /** Expected major version, e.g. 7 for TypeScript 7.x. */
  major?: number;
  /** Expected full version, when a precise match is required. */
  version?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function technologyPattern(technology: string): string {
  const lower = technology.toLowerCase();
  if (lower === 'node' || lower === 'node.js') return 'node(?:\\.js)?';
  if (lower === 'next' || lower === 'next.js') return 'next(?:\\.js)?';
  if (lower === 'discord' || lower === 'discord.js') return 'discord(?:\\.js)?';
  if (lower === 'postgres' || lower === 'postgresql') return 'postgres(?:ql)?';
  if (lower === 'drizzle' || lower === 'drizzle-orm') return 'drizzle(?:-orm)?';
  return escapeRegExp(technology);
}

interface VersionClaim {
  version: string;
  negated: boolean;
}

function negatedClaim(sentence: string, versionIndex: number, versionLength: number): boolean {
  const before = sentence.slice(Math.max(0, versionIndex - 24), versionIndex);
  const after = sentence.slice(versionIndex + versionLength, versionIndex + versionLength + 32);
  if (/\b(?:not|isn't|is not|doesn't|does not|never|no longer|rather than|instead of)\s*$/i.test(before)) {
    return true;
  }
  return /^\s*(?:is|are|was|were)?\s*(?:not|never)\s*(?:used|current|supported|valid|the|a|an|in use)\b/i.test(after);
}

function versionClaims(answer: string, technology: string): VersionClaim[] {
  const pattern = technologyPattern(technology);
  const claims: VersionClaim[] = [];
  const sentences = answer.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    // Require the technology and version in the same sentence, with the
    // technology before or after the version.
    const afterTechnologies = new RegExp(
      `${pattern}[^\\n]{0,40}?v?(\\d+(?:\\.\\d+){0,2})(?![\\d])(?!\\.\\d)`,
      'gi',
    );
    const beforeTechnologies = new RegExp(
      `(?<![\\d.])v?(\\d+(?:\\.\\d+){0,2})(?![\\d])(?!\\.\\d)[^\\n]{0,40}?${pattern}`,
      'gi',
    );

    for (const match of sentence.matchAll(afterTechnologies)) {
      const version = match[1];
      if (!version) continue;
      const versionIndex = (match.index ?? 0) + match[0].lastIndexOf(version);
      claims.push({
        version,
        negated: negatedClaim(sentence, versionIndex, version.length),
      });
    }
    for (const match of sentence.matchAll(beforeTechnologies)) {
      const version = match[1];
      if (!version) continue;
      const versionIndex = (match.index ?? 0) + match[0].indexOf(version);
      claims.push({
        version,
        negated: negatedClaim(sentence, versionIndex, version.length),
      });
    }
  }

  return claims;
}

export function hasSatisfyingVersionClaim(
  answer: string,
  expectation: VersionExpectation,
): boolean {
  const claims = versionClaims(answer, expectation.technology).filter((claim) => !claim.negated);

  if (expectation.version) {
    return claims.some((claim) => claim.version === expectation.version);
  }
  if (expectation.major !== undefined) {
    return claims.some((claim) => Number(claim.version.split('.')[0]) === expectation.major);
  }
  return claims.length > 0;
}

const UNCERTAINTY_MARKERS = [
  /\b(?:cannot|can't|could not|couldn't|unable to)\s+(?:confirm|verify|determine|establish|know|say)\b/i,
  /\b(?:not|isn't|is not)\s+(?:explicitly\s+)?(?:stated|specified|mentioned|documented|confirmed|available)\b/i,
  /\bno\s+(?:current|direct|explicit)\s+(?:evidence|confirmation|information|version|value)\b/i,
  /\bno\s+current\s+(?:package|manifest|file|source)\b/i,
  /\b(?:only|purely)\s+historical\b/i,
  /\bonly\s+(?:covers?|contains?|includes?|confirm|verify)\s+historical\b/i,
  /\bhistorical\s+(?:commits?|evidence)\b[^.!?]{0,40}\bonly\b/i,
  /\bhistorical\s+(?:evidence|commits?)\b.{0,60}\b(?:do not|does not|doesn't|cannot|can't|only|not)\b/i,
  /\b(?:does not|doesn't|cannot|can't)\s+(?:confirm|establish|prove)\s+(?:the\s+)?current\b/i,
  /\bnot\s+(?:proof|evidence)\s+of\s+(?:the\s+)?current\b/i,
  /\bcurrent\s+(?:version|value)\s+(?:cannot|can't|could not|is not)\s+(?:be\s+)?(?:confirmed|determined|verified|stated)\b/i,
  /\binsufficient\s+(?:evidence|information)\b/i,
];

/**
 * True only when the answer explicitly limits its confidence or distinguishes
 * historical evidence from the current state. Bare mentions of "commit" or
 * "historical" are deliberately insufficient.
 */
export function hasDisclosedUncertainty(answer: string): boolean {
  const text = answer.trim();
  if (!text) return false;
  return UNCERTAINTY_MARKERS.some((pattern) => pattern.test(text));
}
