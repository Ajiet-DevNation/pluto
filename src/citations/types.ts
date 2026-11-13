export class CitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CitationError';
  }
}

export interface GitHubCommitCitation {
  kind: 'github-commit';
  owner: string;
  repo: string;
  sha: string;
}

export interface GitHubPullRequestCitation {
  kind: 'github-pull-request';
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubIssueCitation {
  kind: 'github-issue';
  owner: string;
  repo: string;
  number: number;
}

export interface DiscordMessageCitation {
  kind: 'discord-message';
  guildId: string;
  channelId: string;
  messageId: string;
}

export interface MiroBoardCitation {
  kind: 'miro-board';
  boardId: string;
}

export interface MeetingTranscriptCitation {
  kind: 'meeting-transcript';
  meetingId: string;
  /** Location of the stored transcript. Must be an http(s) URL. */
  uri: string;
  timestamp?: string;
}

export type Citation =
  | GitHubCommitCitation
  | GitHubPullRequestCitation
  | GitHubIssueCitation
  | DiscordMessageCitation
  | MiroBoardCitation
  | MeetingTranscriptCitation;

export interface CitationPolicy {
  /**
   * Channels that may never be cited. The bot's own output channel belongs
   * here: answers must not cite other answers, and a self-referential citation
   * is not evidence.
   */
  blockedChannelIds?: readonly string[];
}
