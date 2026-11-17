/**
 * Meeting confirmation / cancellation / rescheduling interaction handler (L3).
 *
 * No new slash command: uses Discord message components (buttons/modals) routed
 * by customId. Likhith exports createConfirmationHandler; Khushi wires it into
 * the shared interaction router in src/discord/bot.ts alongside /ask and /optout.
 *
 * Authorization: only the original announcer (created_by) or a moderator with
 * the Manage Messages permission may confirm, cancel or reschedule. Others get
 * an ephemeral refusal. Confirmation is idempotent.
 */

import type { PgBoss } from 'pg-boss';
import type { MeetingRepository } from './repository.js';
import { scheduleReminder, singletonKey } from './scheduling.js';
import { formatKolkataDate, formatKolkataTime, MEETING_TIMEZONE } from './parsing.js';

const CONFIRM_PREFIX = 'meeting:confirm:';
const CANCEL_PREFIX = 'meeting:cancel:';
const CORRECT_PREFIX = 'meeting:correct:';
const CORRECT_SUBMIT_PREFIX = 'meeting:correct:submit:';

export interface ConfirmationInteraction {
  customId: string | null;
  user: { id: string };
  guildId: string | null;
  reply(options: { content: string; ephemeral?: boolean }): Promise<unknown>;
  deferReply?(): Promise<unknown>;
  editReply?(options: { content: string }): Promise<unknown>;
  /** Modal submit field values, keyed by field custom id. */
  fields?: Record<string, string>;
}

export interface ConfirmationDeps {
  repository: MeetingRepository;
  boss: PgBoss;
  /** (guildId, userId) => whether the user has Manage Messages in the guild. */
  moderatorCheck?: (guildId: string, userId: string) => Promise<boolean>;
  /** Posts the confirmation message (with buttons) to a channel. */
  postConfirmation: (
    channelId: string,
    content: string,
  ) => Promise<{ messageId?: string } | null>;
  logger?: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
    error(message: string, details?: Record<string, unknown>): void;
  };
}

/**
 * Source announcement createdAt, keyed by meeting id. Anchors re-parsing for
 * rescheduling to the original announcement time rather than processing time.
 * Kept in memory for v1; persists only for the process lifetime.
 */
const sourceCreatedAtByMeetingId = new Map<string, Date>();

export interface ConfirmationHandler {
  postConfirmation(
    channelId: string,
    meetingId: string,
    event: {
      title: string;
      startAt: Date;
      timezone: string;
      sourceMessageUrl: string;
    },
    anchorCreatedAt: Date,
  ): Promise<void>;
  handleInteraction(
    interaction: ConfirmationInteraction,
  ): Promise<'handled' | 'ignored' | 'error'>;
}

export function createConfirmationHandler(
  deps: ConfirmationDeps,
): ConfirmationHandler {
  const { repository, boss, postConfirmation } = deps;
  const logger = deps.logger ?? console;

  async function isAuthorized(
    guildId: string | null,
    userId: string,
    createdBy: string,
  ): Promise<boolean> {
    if (userId === createdBy) {
      return true;
    }
    if (deps.moderatorCheck && guildId) {
      try {
        return await deps.moderatorCheck(guildId, userId);
      } catch (error) {
        logger.error('Moderator check failed', {
          guildId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
    return false;
  }

  function refusal(guildId: string | null): string {
    return 'Only the original announcer or an authorized moderator (Manage Messages) can manage this meeting.';
  }

  function reminderWording(startAt: Date): string {
    const reminderMs = startAt.getTime() - 60 * 60 * 1000;
    const now = Date.now();
    if (reminderMs <= now) {
      return 'The meeting starts in under an hour, so the reminder will be posted immediately.';
    }
    return `Reminder scheduled one hour before (${formatKolkataTime(reminderMs)} ${MEETING_TIMEZONE}).`;
  }

  async function postConfirmationMessage(
    channelId: string,
    meetingId: string,
    event: {
      title: string;
      startAt: Date;
      timezone: string;
      sourceMessageUrl: string;
    },
    anchorCreatedAt: Date,
  ): Promise<void> {
    sourceCreatedAtByMeetingId.set(meetingId, anchorCreatedAt);

    const start = new Date(event.startAt);
    const content =
      `**Meeting confirmation** — ${event.title}

Date: ${formatKolkataDate(event.startAt.getTime())}
Time: ${formatKolkataTime(event.startAt.getTime())}
Timezone: ${event.timezone}
${reminderWording(event.startAt)}
Original announcement: ${event.sourceMessageUrl}

Please confirm, cancel, or correct the date/time using the buttons below.`;

    await postConfirmation(channelId, content);
  }

  async function handleConfirm(
    interaction: ConfirmationInteraction,
    meetingId: string,
  ): Promise<'handled' | 'ignored' | 'error'> {
    const event = await repository.getById(meetingId);
    if (!event) {
      await interaction.reply({
        content: 'This meeting event no longer exists.',
        ephemeral: true,
      });
      return 'handled';
    }

    if (!(await isAuthorized(interaction.guildId, interaction.user.id, event.createdBy))) {
      await interaction.reply({ content: refusal(interaction.guildId), ephemeral: true });
      return 'handled';
    }

    if (event.status === 'confirmed') {
      await interaction.reply({
        content: 'This meeting is already confirmed. A reminder has been scheduled.',
        ephemeral: true,
      });
      return 'handled'; // idempotent
    }

    const updated = await repository.confirm(meetingId);
    if (!updated) {
      await interaction.reply({
        content: 'Could not confirm the meeting. It may have been modified.',
        ephemeral: true,
      });
      return 'handled';
    }

    // Schedule the reminder (no-op if meeting already started).
    await scheduleReminder(boss, meetingId, updated.eventVersion, updated.startAt);

    await interaction.reply({
      content: `Confirmed: ${updated.title} on ${formatKolkataDate(updated.startAt.getTime())} at ${formatKolkataTime(updated.startAt.getTime())} ${updated.timezone}. Reminder scheduled.`,
      ephemeral: true,
    });
    return 'handled';
  }

  async function handleCancel(
    interaction: ConfirmationInteraction,
    meetingId: string,
  ): Promise<'handled' | 'ignored' | 'error'> {
    const event = await repository.getById(meetingId);
    if (!event) {
      await interaction.reply({ content: 'This meeting event no longer exists.', ephemeral: true });
      return 'handled';
    }

    if (!(await isAuthorized(interaction.guildId, interaction.user.id, event.createdBy))) {
      await interaction.reply({ content: refusal(interaction.guildId), ephemeral: true });
      return 'handled';
    }

    if (event.status === 'cancelled') {
      await interaction.reply({ content: 'This meeting is already cancelled.', ephemeral: true });
      return 'handled'; // idempotent
    }

    const updated = await repository.cancel(meetingId, event.eventVersion);
    if (!updated) {
      await interaction.reply({
        content: 'Could not cancel the meeting. It may have been modified by another action.',
        ephemeral: true,
      });
      return 'handled';
    }

    await interaction.reply({
      content: `Cancelled: ${updated.title}. Old reminder jobs are now no-ops (version ${updated.eventVersion}).`,
      ephemeral: true,
    });
    return 'handled';
  }

  async function handleCorrectSubmit(
    interaction: ConfirmationInteraction,
    meetingId: string,
  ): Promise<'handled' | 'ignored' | 'error'> {
    const event = await repository.getById(meetingId);
    if (!event) {
      await interaction.reply({ content: 'This meeting event no longer exists.', ephemeral: true });
      return 'handled';
    }

    if (!(await isAuthorized(interaction.guildId, interaction.user.id, event.createdBy))) {
      await interaction.reply({ content: refusal(interaction.guildId), ephemeral: true });
      return 'handled';
    }

    const anchor = sourceCreatedAtByMeetingId.get(meetingId) ?? new Date();
    const corrected = (interaction.fields && interaction.fields.dateTime) || '';
    if (!corrected) {
      await interaction.reply({
        content: 'Please provide the corrected date and time (for example "tomorrow at 4 PM").',
        ephemeral: true,
      });
      return 'handled';
    }

    // Re-parse deterministically using the original announcement anchor.
    const { parseMeeting } = await import('./parsing.js');
    const parsed = parseMeeting(corrected, anchor);

    if (parsed.kind !== 'ok' || !parsed.startAt) {
      await interaction.reply({
        content: `Could not reschedule: ${parsed.clarification ?? 'unable to parse date/time'}`,
        ephemeral: true,
      });
      return 'handled';
    }

    const updated = await repository.reschedule(meetingId, event.eventVersion, parsed.startAt);
    if (!updated) {
      await interaction.reply({
        content: 'Could not reschedule. The meeting may have been modified by another action.',
        ephemeral: true,
      });
      return 'handled';
    }

    // Schedule a new reminder; old jobs become no-ops (version bumped).
    await scheduleReminder(boss, meetingId, updated.eventVersion, updated.startAt);

    await interaction.reply({
      content: `Rescheduled: ${updated.title} to ${formatKolkataDate(updated.startAt.getTime())} at ${formatKolkataTime(updated.startAt.getTime())} ${updated.timezone}. A new reminder has been scheduled; the previous reminder (if already sent) remains unchanged.`,
      ephemeral: true,
    });
    return 'handled';
  }

  async function handleInteraction(
    interaction: ConfirmationInteraction,
  ): Promise<'handled' | 'ignored' | 'error'> {
    const customId = interaction.customId;
    if (!customId) {
      return 'ignored';
    }

    try {
      if (customId.startsWith(CONFIRM_PREFIX)) {
        const meetingId = customId.slice(CONFIRM_PREFIX.length);
        return handleConfirm(interaction, meetingId);
      }
      if (customId.startsWith(CANCEL_PREFIX)) {
        const meetingId = customId.slice(CANCEL_PREFIX.length);
        return handleCancel(interaction, meetingId);
      }
      if (customId.startsWith(CORRECT_SUBMIT_PREFIX)) {
        const meetingId = customId.slice(CORRECT_SUBMIT_PREFIX.length);
        return handleCorrectSubmit(interaction, meetingId);
      }
      if (customId.startsWith(CORRECT_PREFIX)) {
        // Correct button clicked: prompt for corrected date/time via a modal.
        await interaction.reply({
          content: 'Please submit the corrected date and time using the correction form (for example "Friday at 10:30 AM").',
          ephemeral: true,
        });
        return 'handled';
      }
      return 'ignored';
    } catch (error) {
      logger.error('Confirmation handler failed', {
        customId,
        userId: interaction.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await interaction.reply({
          content: 'Something went wrong while handling that. Please try again.',
          ephemeral: true,
        });
      } catch {
        // Ignore reply failures.
      }
      return 'error';
    }
  }

  return { postConfirmation: postConfirmationMessage, handleInteraction };
}
