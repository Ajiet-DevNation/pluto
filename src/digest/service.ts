/**
 * On-demand deterministic activity snapshot (P3).
 *
 * `/digest` is not an AI-written summary and has no scheduler. It counts only
 * indexed records that carry a reliable occurrence date:
 *
 * - GitHub issues created in the window;
 * - Discord messages indexed in the window, with a `#decisions` subset;
 * - confirmed upcoming meetings and scheduled upcoming events.
 *
 * Pull requests and commits are not reported. Opted-out and bot-authored
 * Discord records are never counted.
 */

import type { DiscordIndexRecord } from '../discord/types';
import { isWithinWindow, rollingWindow } from '../events/time';
import type { UpcomingRepository } from '../upcoming/repository';
import type { DigestIssue } from './issues';

export const DIGEST_DEFAULT_DAYS = 7;
export const DIGEST_MIN_DAYS = 1;
export const DIGEST_MAX_DAYS = 30;
export const DIGEST_UPCOMING_LIMIT = 5;

export interface DigestServiceDependencies {
  listIssuesCreatedBetween(from: Date, to: Date): Promise<DigestIssue[]>;
  listDiscordRecords(): Promise<DiscordIndexRecord[]>;
  /** Defense in depth for a failed opt-out purge; the store is also purged. */
  isOptedOut(guildId: string, userId: string): Promise<boolean>;
  upcoming: Pick<
    UpcomingRepository,
    'listMeetings' | 'countMeetings' | 'listEvents' | 'countEvents'
  >;
  /** The allowlisted `#decisions` channel, or `null` when not configured. */
  decisionsChannelId: string | null;
  /** Exactly the allowlisted channel ids. */
  indexedChannelIds: ReadonlySet<string>;
  now?: () => Date;
}

export interface DigestReport {
  days: number;
  from: Date;
  to: Date;
  githubIssues: DigestIssue[];
  githubIssueCount: number;
  discordMessageCount: number;
  decisionsMessageCount: number;
  upcomingMeetingCount: number;
  upcomingMeetings: Awaited<ReturnType<UpcomingRepository['listMeetings']>>;
  upcomingEventCount: number;
  upcomingEvents: Awaited<ReturnType<UpcomingRepository['listEvents']>>;
}

export interface DigestService {
  build(input: { guildId: string; days?: number | null }): Promise<DigestReport>;
}

/** `null` when the value is not a whole number in 1–30. */
export function normalizeDigestDays(
  days: number | null | undefined,
): number | null {
  if (days === null || days === undefined) {
    return DIGEST_DEFAULT_DAYS;
  }
  if (
    !Number.isInteger(days) ||
    days < DIGEST_MIN_DAYS ||
    days > DIGEST_MAX_DAYS
  ) {
    return null;
  }
  return days;
}

async function filterOptedOut(
  records: readonly DiscordIndexRecord[],
  guildId: string,
  isOptedOut: (guildId: string, userId: string) => Promise<boolean>,
): Promise<DiscordIndexRecord[]> {
  if (records.length === 0) {
    return [];
  }

  const authorIds = [...new Set(records.map((record) => record.authorId))];
  const decisions = await Promise.all(
    authorIds.map(async (authorId) => ({
      authorId,
      optedOut: await isOptedOut(guildId, authorId),
    })),
  );
  const optedOut = new Set(
    decisions.filter((entry) => entry.optedOut).map((entry) => entry.authorId),
  );
  return optedOut.size === 0
    ? [...records]
    : records.filter((record) => !optedOut.has(record.authorId));
}

export function createDigestService(
  dependencies: DigestServiceDependencies,
): DigestService {
  return {
    async build({ guildId, days }) {
      const normalized = normalizeDigestDays(days);
      if (normalized === null) {
        throw new RangeError(
          `digest days must be an integer from ${DIGEST_MIN_DAYS} to ${DIGEST_MAX_DAYS}`,
        );
      }

      const now = dependencies.now?.() ?? new Date();
      const { from, to } = rollingWindow(now, normalized);

      const [
        githubIssues,
        records,
        upcomingMeetings,
        upcomingMeetingCount,
        upcomingEvents,
        upcomingEventCount,
      ] = await Promise.all([
        dependencies.listIssuesCreatedBetween(from, to),
        dependencies.listDiscordRecords(),
        dependencies.upcoming.listMeetings(
          guildId,
          now,
          DIGEST_UPCOMING_LIMIT,
        ),
        dependencies.upcoming.countMeetings(guildId, now),
        dependencies.upcoming.listEvents(guildId, now, DIGEST_UPCOMING_LIMIT),
        dependencies.upcoming.countEvents(guildId, now),
      ]);

      const windowRecords = records.filter(
        (record) =>
          record.guildId === guildId &&
          !record.authorIsBot &&
          dependencies.indexedChannelIds.has(record.channelId) &&
          isWithinWindow(record.createdAt, from, to),
      );
      // `/optout` purges stored records, but retrieval also filters at read
      // time because a purge can fail. `/digest` applies the same read-time
      // filter so opted-out activity is never counted.
      const visibleRecords = await filterOptedOut(
        windowRecords,
        guildId,
        dependencies.isOptedOut,
      );
      const decisionsMessageCount = dependencies.decisionsChannelId
        ? visibleRecords.filter(
            (record) =>
              record.channelId === dependencies.decisionsChannelId,
          ).length
        : 0;

      return {
        days: normalized,
        from,
        to,
        githubIssues,
        githubIssueCount: githubIssues.length,
        discordMessageCount: visibleRecords.length,
        decisionsMessageCount,
        upcomingMeetingCount,
        upcomingMeetings,
        upcomingEventCount,
        upcomingEvents,
      };
    },
  };
}

