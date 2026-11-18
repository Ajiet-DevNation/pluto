/**
 * Deterministic formatting for `/upcoming`.
 */

import {
  fitDiscordContent,
  neutralizeMassMentions,
  sanitizeDescription,
  sanitizeInline,
} from '../events/text';
import { formatIstDateTime, formatIstRange } from '../events/time';
import type { UpcomingEvent, UpcomingMeeting } from './repository';

export const UPCOMING_MESSAGES = {
  noMeetings: 'No confirmed upcoming meetings.',
  noEvents: 'No scheduled upcoming events.',
  error: 'Something went wrong while loading upcoming items. Please try again.',
  wrongGuild: 'This command works only inside the DevNation server.',
} as const;

export const UPCOMING_DISPLAY_LIMIT = 10;

export function formatMeetingList(
  meetings: readonly UpcomingMeeting[],
  limit: number = UPCOMING_DISPLAY_LIMIT,
): string {
  if (meetings.length === 0) {
    return UPCOMING_MESSAGES.noMeetings;
  }

  const lines = ['Confirmed upcoming meetings'];
  for (const meeting of meetings.slice(0, limit)) {
    const title = neutralizeMassMentions(sanitizeInline(meeting.title));
    lines.push(`• ${formatIstDateTime(meeting.startAt)} — ${title}`);
    if (meeting.sourceMessageUrl) {
      lines.push(`  ${meeting.sourceMessageUrl}`);
    }
  }
  return fitDiscordContent(lines.join('\n'));
}

export function formatEventList(
  upcomingEvents: readonly UpcomingEvent[],
  now: Date,
  limit: number = UPCOMING_DISPLAY_LIMIT,
): string {
  if (upcomingEvents.length === 0) {
    return UPCOMING_MESSAGES.noEvents;
  }

  const lines = ['Scheduled upcoming events'];
  for (const event of upcomingEvents.slice(0, limit)) {
    const title = neutralizeMassMentions(sanitizeInline(event.title));
    const ongoing =
      event.endAt !== null &&
      event.startAt.getTime() <= now.getTime() &&
      event.endAt.getTime() > now.getTime();
    lines.push(
      `• ${formatIstRange(event.startAt, event.endAt)} — ${title} (ID: ${event.id})${
        ongoing ? ' (ongoing)' : ''
      }`,
    );
    if (event.description) {
      const description = neutralizeMassMentions(
        sanitizeDescription(event.description),
      )
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      lines.push(description);
    }
  }
  return fitDiscordContent(lines.join('\n'));
}
