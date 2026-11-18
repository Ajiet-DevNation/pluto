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

const MEETINGS_HEADER = '**Confirmed upcoming meetings**';
const EVENTS_HEADER = '**Scheduled upcoming events**';

export function formatMeetingList(
  meetings: readonly UpcomingMeeting[],
  limit: number = UPCOMING_DISPLAY_LIMIT,
): string {
  if (meetings.length === 0) {
    return `${MEETINGS_HEADER}\n\n${UPCOMING_MESSAGES.noMeetings}`;
  }

  const lines = [MEETINGS_HEADER, ''];
  for (const meeting of meetings.slice(0, limit)) {
    const title = neutralizeMassMentions(sanitizeInline(meeting.title));
    lines.push(`• **${title}**`);
    lines.push(`  **${formatIstDateTime(meeting.startAt)}**`);
    if (meeting.sourceMessageUrl) {
      lines.push(`  <${meeting.sourceMessageUrl}>`);
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return fitDiscordContent(lines.join('\n'));
}

export function formatEventList(
  upcomingEvents: readonly UpcomingEvent[],
  now: Date,
  limit: number = UPCOMING_DISPLAY_LIMIT,
): string {
  if (upcomingEvents.length === 0) {
    return `${EVENTS_HEADER}\n\n${UPCOMING_MESSAGES.noEvents}`;
  }

  const lines = [EVENTS_HEADER, ''];
  for (const event of upcomingEvents.slice(0, limit)) {
    const title = neutralizeMassMentions(sanitizeInline(event.title));
    const ongoing =
      event.endAt !== null &&
      event.startAt.getTime() <= now.getTime() &&
      event.endAt.getTime() > now.getTime();
    lines.push(
      `• **${title}** · \`ID ${event.id}\`${ongoing ? ' · *(ongoing)*' : ''}`,
    );
    lines.push(`  **${formatIstRange(event.startAt, event.endAt)}**`);
    if (event.description) {
      const description = neutralizeMassMentions(
        sanitizeDescription(event.description),
      )
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      lines.push(description);
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return fitDiscordContent(lines.join('\n'));
}
