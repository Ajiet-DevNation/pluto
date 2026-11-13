import { githubCommitUrl, githubIssueUrl, githubPullRequestUrl } from './github';
import { discordMessageUrl } from './discord';
import { miroBoardUrl } from './miro';
import { meetingTranscriptUrl } from './meeting';
import type { Citation, CitationPolicy } from './types';

export * from './types';
export { CitationError } from './types';
export { githubCommitUrl, githubIssueUrl, githubPullRequestUrl } from './github';
export { discordMessageUrl } from './discord';
export { miroBoardUrl } from './miro';
export { meetingTranscriptUrl } from './meeting';

/**
 * Build the policy from the environment.
 * DISCORD_OUTPUT_CHANNEL_ID is the bot's own surface (#pluto) and is never a
 * valid source.
 */
export function defaultCitationPolicy(
  env: Record<string, string | undefined> = process.env,
): CitationPolicy {
  const outputChannelId = env.DISCORD_OUTPUT_CHANNEL_ID?.trim();
  return {
    blockedChannelIds: outputChannelId ? [outputChannelId] : [],
  };
}

export function citationUrl(
  citation: Citation,
  policy: CitationPolicy = defaultCitationPolicy(),
): string {
  switch (citation.kind) {
    case 'github-commit':
      return githubCommitUrl(citation);
    case 'github-pull-request':
      return githubPullRequestUrl(citation);
    case 'github-issue':
      return githubIssueUrl(citation);
    case 'discord-message':
      return discordMessageUrl(citation, policy);
    case 'miro-board':
      return miroBoardUrl(citation);
    case 'meeting-transcript':
      return meetingTranscriptUrl(citation);
    default: {
      const exhaustive: never = citation;
      throw new Error(`Unsupported citation kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function citationLabel(citation: Citation): string {
  switch (citation.kind) {
    case 'github-commit':
      return `commit ${citation.sha.slice(0, 7)}`;
    case 'github-pull-request':
      return `PR #${citation.number}`;
    case 'github-issue':
      return `issue #${citation.number}`;
    case 'discord-message':
      return 'Discord message';
    case 'miro-board':
      return 'Miro board';
    case 'meeting-transcript':
      return 'Meeting transcript';
  }
}

/**
 * Render citations as a markdown list, de-duplicated by URL and order-stable.
 */
export function renderCitations(
  citations: readonly Citation[],
  policy: CitationPolicy = defaultCitationPolicy(),
): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const citation of citations) {
    const url = citationUrl(citation, policy);
    if (seen.has(url)) continue;
    seen.add(url);
    lines.push(`- [${citationLabel(citation)}](${url})`);
  }

  return lines.join('\n');
}
