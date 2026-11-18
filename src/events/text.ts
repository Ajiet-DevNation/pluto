/**
 * Small presentation helpers shared by the P3 commands.
 *
 * Discord accepts at most 2,000 characters in one message. Outputs are built
 * deterministically and truncated at a safe boundary with a visible marker.
 */

export const DISCORD_CONTENT_LIMIT = 2_000;

const TRUNCATION_SUFFIX = '\n\n… [truncated]';

/** Remove control characters and collapse line breaks for one-line fields. */
export function sanitizeInline(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise a multi-line description without allowing control characters. */
export function sanitizeDescription(value: string): string {
  return value
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Neutralise literal mass mentions in user-supplied text. The caller still
 * sends with `allowedMentions: { parse: [] }`; this is defence in depth so a
 * public record can never contain `@everyone` or `@here`.
 */
export function neutralizeMassMentions(value: string): string {
  return value.replace(/@(everyone|here)\b/gi, '$1');
}

export function fitDiscordContent(
  content: string,
  limit: number = DISCORD_CONTENT_LIMIT,
): string {
  if (limit <= 0) {
    return '';
  }
  if (content.length <= limit) {
    return content;
  }

  const suffix = TRUNCATION_SUFFIX.length <= limit ? TRUNCATION_SUFFIX : '…';
  const budget = limit - suffix.length;
  if (budget <= 0) {
    return suffix.slice(0, limit);
  }

  let truncated = content.slice(0, budget);
  // Never split a UTF-16 surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(truncated)) {
    truncated = truncated.slice(0, -1);
  }
  // Prefer a line boundary, then a word boundary, when the loss is small.
  const lineBoundary = truncated.lastIndexOf('\n');
  if (lineBoundary >= Math.floor(budget * 0.6)) {
    truncated = truncated.slice(0, lineBoundary);
  } else {
    const wordBoundary = truncated.search(/\s+\S*$/);
    if (wordBoundary >= Math.floor(budget * 0.6)) {
      truncated = truncated.slice(0, wordBoundary);
    }
  }

  return `${truncated.trimEnd()}${suffix}`;
}
