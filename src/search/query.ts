/**
 * Query construction for retrieval.
 *
 * PostgreSQL's `plainto_tsquery` joins every term with AND, so a natural
 * question such as "which embedding model does search use?" matches nothing
 * unless one chunk contains every word. Repository-qualified questions are
 * worse: `Ajiet-DevNation/pluto` is tokenised into several lexemes that only
 * appear in some chunks, so full-text search returns zero rows.
 *
 * This module turns a question into a safe, bounded full-text query:
 *
 * - remove URLs, repository qualifiers and the organization name
 * - drop question words / generic verbs, which otherwise dominate ranking
 * - keep dotted, underscored and hyphenated identifiers as terms
 * - expand an identifier into its parts (`next.js` → `next.js`, `next`, `js`)
 * - build an OR query for recall and an AND query for precision
 *
 * It also recognises references to a specific indexed source (issue number,
 * pull-request number, commit SHA) so retrieval can look the source up
 * directly instead of hoping that a similarity search finds it.
 */

const STOPWORDS = new Set([
  'a', 'about', 'above', 'according', 'actually', 'add', 'added', 'after',
  'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as',
  'at', 'available', 'be', 'been', 'before', 'being', 'below', 'between',
  'both', 'by', 'can', 'change', 'changed', 'changes', 'could', 'commit',
  'commits', 'current', 'currently', 'describe', 'did', 'do', 'does', 'during',
  'each', 'exactly', 'explain', 'few', 'find', 'for', 'from', 'further',
  'give', 'had', 'has', 'have', 'here', 'how', 'i', 'if', 'in', 'include',
  'included', 'includes', 'into', 'involve', 'involves', 'is', 'it', 'its',
  'just', 'list', 'made', 'make', 'makes', 'many', 'may', 'me', 'might',
  'more', 'most', 'much', 'must', 'my', 'no', 'not', 'of', 'on', 'once',
  'only', 'or', 'other', 'our', 'over', 'own', 'please', 'really',
  'regarding', 'related', 'same', 'say', 'says', 'shall', 'should', 'show',
  'so', 'some', 'still', 'such', 'summarize', 'summarise', 'tell', 'than',
  'that', 'the', 'their', 'them', 'then', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'us', 'use', 'used',
  'uses', 'using', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'whom', 'whose', 'why', 'will', 'with', 'within',
  'without', 'work', 'working', 'works', 'would', 'you', 'your',
]);

/** Words that describe the shape of a question rather than its subject. */
const GENERIC_TERMS = new Set([
  'repo', 'repos', 'repository', 'repositories',
]);

const TOKEN_PATTERN = /[\p{L}\p{N}_]+(?:[._-][\p{L}\p{N}_]+)*/gu;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

export interface FullTextQuery {
  /** Cleaned question without repository/organization qualifiers. */
  cleaned: string;
  /** AND of the term groups; empty when every term was a stopword. */
  strictText: string;
  /** OR of the term groups; empty when every term was a stopword. */
  broadText: string;
  /** One tsquery group per retained term, e.g. `(next.js | next | js)`. */
  groups: string[];
  /** Human-readable retained terms, used by tests and diagnostics. */
  terms: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, ' ');
}

function stripRepository(text: string, repositoryFullName?: string): string {
  if (!repositoryFullName) {
    return text;
  }
  return text.replace(new RegExp(escapeRegExp(repositoryFullName), 'gi'), ' ');
}

function stripOrganization(text: string, organizationName?: string): string {
  if (!organizationName) {
    return text;
  }
  return text.replace(new RegExp(escapeRegExp(organizationName), 'gi'), ' ');
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
}

function variantsFor(token: string): string[] {
  const parts = token
    .split(/[._-]/)
    .filter((part) => part.length >= 2 && !STOPWORDS.has(part) && !GENERIC_TERMS.has(part));
  return [...new Set([token, ...parts])];
}

/**
 * Build the strict/broad tsquery text for a question. The output never
 * contains user punctuation, so it can be passed to `to_tsquery` safely.
 */
export function buildFullTextQuery(
  question: string,
  repositoryFullName?: string,
  organizationName?: string,
): FullTextQuery {
  let cleaned = stripUrls(question);
  cleaned = stripRepository(cleaned, repositoryFullName);
  cleaned = stripOrganization(cleaned, organizationName);

  const terms: string[] = [];
  const groups: string[] = [];
  const strictGroups: string[] = [];
  const seen = new Set<string>();

  for (const token of tokenize(cleaned)) {
    if (token.length < 2 && !/\d/.test(token)) continue;
    if (STOPWORDS.has(token) || GENERIC_TERMS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);

    const variants = variantsFor(token);
    if (variants.length === 0) continue;
    terms.push(token);
    // Strict uses the full token (stemmed by PostgreSQL), not its parts.
    // `next.js` is precise; `next` alone is not.
    strictGroups.push(`(${token})`);
    groups.push(`(${variants.join(' | ')})`);
  }

  return {
    cleaned: cleaned.replace(/\s+/g, ' ').trim(),
    strictText: strictGroups.join(' & '),
    broadText: groups.join(' | '),
    groups,
    terms,
  };
}

/**
 * Source ids that a question names explicitly, scoped to a repository.
 *
 * Examples (`Ajiet-DevNation/pluto`):
 * - "pull request #12" → `Ajiet-DevNation/pluto#pr-12`
 * - "issue #9"         → `Ajiet-DevNation/pluto#9`
 *
 * A question without an explicit repository cannot be resolved safely because
 * issue/PR numbers repeat across repositories; callers fall back to hybrid
 * search in that case.
 */
export function sourceReferencesFromQuestion(
  question: string,
  repositoryFullName?: string,
): string[] {
  const repository = repositoryFullName?.trim().replace(/[.,;:!?]+$/, '');
  if (!repository) {
    return [];
  }

  const ids = new Set<string>();
  const number = String.raw`\s*(?:number\s*)?#?\s*(\d+)\b`;

  for (const match of question.matchAll(new RegExp(String.raw`\b(?:pull\s+request|pr)${number}`, 'gi'))) {
    ids.add(`${repository}#pr-${match[1]}`);
  }
  for (const match of question.matchAll(new RegExp(String.raw`\b(?:issue|bug)${number}`, 'gi'))) {
    ids.add(`${repository}#${match[1]}`);
  }
  for (const match of question.matchAll(/\b(?:commit|sha)\s*(?:id\s*)?#?\s*([0-9a-f]{7,40})\b/gi)) {
    ids.add(`${repository}@${match[1].toLowerCase()}`);
  }

  return [...ids];
}

/**
 * Remove exact duplicate content before the evidence gate.
 *
 * Identical files appear in several repositories, and re-indexing can produce
 * identical chunks from different sources. Keeping the highest-scoring copy
 * avoids spending the answer context on repeated text and gives other sources
 * a chance to be represented.
 */
export function dedupeChunksByContent<T extends { content: string; score: number }>(
  chunks: readonly T[],
): T[] {
  const best = new Map<string, T>();
  for (const chunk of chunks) {
    const key = chunk.content.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key) continue;
    const existing = best.get(key);
    if (!existing || chunk.score > existing.score) {
      best.set(key, chunk);
    }
  }
  return [...best.values()];
}
