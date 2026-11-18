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

function issueLine(
  repositoryFullName: string,
  number: number,
  title: string,
): string {
  return `• **${sanitizeInline(repositoryFullName)}#${number}** — ${neutralizeMassMentions(sanitizeInline(title))}`;
}

export function formatDigest(report: DigestReport): string {
  const dayLabel = `${report.days} day${report.days === 1 ? '' : 's'}`;
  const lines: string[] = [
    `**Activity digest** — last ${dayLabel}`,
    `Window: ${formatIstDateTimeCompact(report.from)} → ${formatIstDateTimeCompact(
      report.to,
    )}`,
    '',
    '**Activity**',
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
    lines.push(`• **GitHub issues created:** ${report.githubIssueCount}`);
    lines.push(`• **Discord messages indexed:** ${report.discordMessageCount}`);
    lines.push(`• **#decisions:** ${report.decisionsMessageCount}`);
  }

  lines.push('', `*${DIGEST_FOOTER}*`);

  if (report.upcomingMeetingCount === 0) {
    lines.push('', '**Upcoming meetings:** none');
  } else {
    lines.push('', `**Upcoming meetings:** ${report.upcomingMeetingCount}`, '');
    for (const meeting of report.upcomingMeetings.slice(
      0,
      DIGEST_UPCOMING_LIMIT,
    )) {
      const title = neutralizeMassMentions(sanitizeInline(meeting.title));
      lines.push(`• **${title}**`);
      lines.push(`  **${formatIstDateTime(meeting.startAt)}**`);
      if (meeting.sourceMessageUrl) {
        lines.push(`  <${meeting.sourceMessageUrl}>`);
      }
      lines.push('');
    }
    if (report.upcomingMeetingCount > report.upcomingMeetings.length) {
      lines.push(
        `• …and ${
          report.upcomingMeetingCount - report.upcomingMeetings.length
        } more`,
      );
    }
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
  }

  if (report.upcomingEventCount === 0) {
    lines.push('', '**Upcoming events:** none');
  } else {
    lines.push('', `**Upcoming events:** ${report.upcomingEventCount}`, '');
    for (const event of report.upcomingEvents.slice(
      0,
      DIGEST_UPCOMING_LIMIT,
    )) {
      const title = neutralizeMassMentions(sanitizeInline(event.title));
      lines.push(`• **${title}** · \`ID ${event.id}\``);
      lines.push(`  **${formatIstRange(event.startAt, event.endAt)}**`);
      lines.push('');
    }
    if (report.upcomingEventCount > report.upcomingEvents.length) {
      lines.push(
        `• …and ${
          report.upcomingEventCount - report.upcomingEvents.length
        } more`,
      );
    }
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
  }

  if (report.githubIssues.length > 0) {
    lines.push('', '**Recent GitHub issues**');
    for (const issue of report.githubIssues.slice(0, RECENT_ISSUE_LIMIT)) {
      lines.push(
        issueLine(
          issue.repositoryFullName,
          issue.number,
          issue.title,
        ),
      );
      lines.push(`  <${sanitizeInline(issue.htmlUrl)}>`);
    }
    if (report.githubIssueCount > RECENT_ISSUE_LIMIT) {
      lines.push(`• …and ${report.githubIssueCount - RECENT_ISSUE_LIMIT} more`);
    }
  }

  return fitDiscordContent(lines.join('\n'));
}
