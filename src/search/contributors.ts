/**
 * Contributor lookup result formatting and failure classification.
 *
 * The lookup itself is injected by the runtime and uses the existing read-only
 * GitHub reader. This module deliberately contains no GitHub or database I/O.
 */

export interface ContributorCandidate {
  login: string | null;
  contributions: number;
}

export type ContributorFailureKind =
  | 'not-found'
  | 'rate-limited'
  | 'forbidden'
  | 'not-allowed'
  | 'empty'
  | 'unavailable';

/** Contributor answers use the normal answer cache; do not imply live data. */
export const CONTRIBUTOR_CACHE_NOTE =
  'GitHub contributor data may be reused for identical questions and can lag recent changes.';

export class ContributorLookupError extends Error {
  constructor(
    readonly kind: ContributorFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'ContributorLookupError';
  }
}

export function contributorsPageUrl(repositoryFullName: string): string {
  const [owner, repo] = repositoryFullName.split('/');
  const safeOwner = (owner ?? '').trim();
  const safeRepo = (repo ?? '').trim();
  if (!safeOwner || !safeRepo) {
    throw new ContributorLookupError('not-found', `Invalid repository name: ${repositoryFullName}`);
  }
  return `https://github.com/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/graphs/contributors`;
}

export function formatContributors(
  repositoryFullName: string,
  contributors: ReadonlyArray<ContributorCandidate>,
): string {
  const named = contributors.filter(
    (contributor): contributor is ContributorCandidate & { login: string } =>
      typeof contributor.login === 'string' && contributor.login.trim().length > 0,
  );
  const anonymousContributions = contributors
    .filter((contributor) => !contributor.login || contributor.login.trim().length === 0)
    .reduce((total, contributor) => total + contributor.contributions, 0);

  const top = named.slice(0, 25);
  const listed = top
    .map((contributor) =>
      contributor.contributions > 0
        ? `${contributor.login} (${contributor.contributions} contributions)`
        : contributor.login,
    )
    .join(', ');
  const suffix = named.length > top.length
    ? `, and ${named.length - top.length} more named contributors`
    : '';
  const anonymous = anonymousContributions > 0
    ? `${listed ? ' ' : ''}Anonymous contributors: ${anonymousContributions} contributions.`
    : '';

  if (!listed && anonymousContributions > 0) {
    return `Contributors to ${repositoryFullName}: anonymous contributors (${anonymousContributions} contributions).`;
  }
  if (!listed) {
    return `GitHub returned no contributor identities or contribution counts for ${repositoryFullName}.`;
  }
  return `Contributors to ${repositoryFullName}: ${listed}${suffix}.${anonymous}`.trim();
}
