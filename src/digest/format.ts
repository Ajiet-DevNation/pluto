/**
 * Deterministic `/digest` rendering. No AI narrative is generated.
 */

import {
  fitDiscordContent,
  neutralizeMassMentions,
  sanitizeInline,
} from '../events/text';
import {
  formatIstDateTime,
  formatIstDateTimeCompact,
  formatIstRange,
} from '../events/time';
import type { DigestReport } from './service';
import { DIGEST_UPCOMING_LIMIT } from './service';

const RECENT_ISSUE_LIMIT = 5;

export const DIGEST_FOOTER =
  'Pull requests and commits are not reported because reliable occurrence dates are not stored.';

export function formatDigest(report: DigestReport): string {
  const dayLabel = `${report.days} day${report.days === 1 ? '' : 's'}`;
  const lines: string[] = [
    `Activity digest — last ${dayLabel}`,
    `Window: ${formatIstDateTimeCompact(report.from)} → ${formatIstDateTimeCompact(
      report.to,
    )}`,
    '',
  ];

  const windowIsEmpty =
    report.githubIssueCount === 0 &&
    report.discordMessageCount === 0 &&
    report.decisionsMessageCount === 0;

  if (windowIsEmpty) {
    lines.push(
      'No indexed GitHub issues, Discord messages, or #decisions messages were recorded in this period.',
    );
  } else {
    lines.push(`GitHub issues created: ${report.githubIssueCount}`);
    lines.push(`Discord messages indexed: ${report.discordMessageCount}`);
    lines.push(`• #decisions: ${report.decisionsMessageCount}`);
  }

  lines.push('', DIGEST_FOOTER, '');
  if (report.upcomingMeetingCount === 0) {
    lines.push('Upcoming meetings: none');
  } else {
    lines.push(`Upcoming meetings: ${report.upcomingMeetingCount}`);
    for (const meeting of report.upcomingMeetings.slice(
      0,
      DIGEST_UPCOMING_LIMIT,
    )) {
      const title = neutralizeMassMentions(sanitizeInline(meeting.title));
      lines.push(`• ${formatIstDateTime(meeting.startAt)} — ${title}`);
      if (meeting.sourceMessageUrl) {
        lines.push(`  ${meeting.sourceMessageUrl}`);
      }
    }
    if (report.upcomingMeetingCount > report.upcomingMeetings.length) {
      lines.push(
        `• …and ${
          report.upcomingMeetingCount - report.upcomingMeetings.length
        } more`,
      );
    }
  }

  if (report.upcomingEventCount === 0) {
    lines.push('Upcoming events: none');
  } else {
    lines.push(`Upcoming events: ${report.upcomingEventCount}`);
    for (const event of report.upcomingEvents.slice(
      0,
      DIGEST_UPCOMING_LIMIT,
    )) {
      const title = neutralizeMassMentions(sanitizeInline(event.title));
      lines.push(
        `• ${formatIstRange(event.startAt, event.endAt)} — ${title} (ID: ${event.id})`,
      );
    }
    if (report.upcomingEventCount > report.upcomingEvents.length) {
      lines.push(
        `• …and ${
          report.upcomingEventCount - report.upcomingEvents.length
        } more`,
      );
    }
  }

  if (report.githubIssues.length > 0) {
    lines.push('', 'Recent GitHub issues');
    for (const issue of report.githubIssues.slice(0, RECENT_ISSUE_LIMIT)) {
      const title = neutralizeMassMentions(sanitizeInline(issue.title));
      lines.push(
        `• ${sanitizeInline(issue.repositoryFullName)}#${issue.number} — ${title}`,
      );
      lines.push(`  ${sanitizeInline(issue.htmlUrl)}`);
    }
    if (report.githubIssueCount > RECENT_ISSUE_LIMIT) {
      lines.push(`• …and ${report.githubIssueCount - RECENT_ISSUE_LIMIT} more`);
    }
  }

  return fitDiscordContent(lines.join('\n'));
}
