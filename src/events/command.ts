/**
 * `/event add` and `/event cancel` — manual club event management.
 *
 * Both subcommands are available to every guild member. Organizers can cancel
 * events they created; members with Manage Events can cancel any event. Input
 * uses strict `YYYY-MM-DD` and either 12-hour or 24-hour time in Asia/Kolkata;
 * output uses 12-hour IST.
 *
 * The database row is written first in both flows. The public record or
 * cancellation notice is posted once to the configured `#events` channel. If
 * the public post fails, the row is kept and the organizer is told honestly.
 * Original `#events` messages are never edited or deleted.
 */

import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import type { DiscordLogger } from '../discord/types';
import { defaultLogger, errorMessage } from '../discord/types';
import type { EventRepository } from './repository';
import { formatIstRange, IST_TIMEZONE, resolveEventTiming } from './time';
import {
  fitDiscordContent,
  neutralizeMassMentions,
  sanitizeDescription,
  sanitizeInline,
} from './text';

export const EVENT_TITLE_MAX_LENGTH = 200;
export const EVENT_DESCRIPTION_MAX_LENGTH = 1_000;

export const EVENT_MESSAGES = {
  wrongGuild: 'This command works only inside the DevNation server.',
  invalidTitle: 'Event title must be between 1 and 200 characters.',
  invalidDescription:
    'Event description must be 1,000 characters or fewer.',
  invalidId: 'Event ID must be a positive whole number from /upcoming events.',
  notFound: 'No scheduled event with that ID was found in this server.',
  alreadyCancelled:
    'That event is already cancelled or no longer scheduled.',
  notAllowedToCancel:
    'You can cancel events you created. Members with Manage Events can cancel any event.',
  unavailable:
    'Event management is not available right now because the database or #events channel is not configured.',
  error: 'Something went wrong while saving the event. Please try again.',
  cancelError:
    'Something went wrong while cancelling the event. Please try again.',
  publicPostFailed:
    'The event was saved, but I could not post the public record in #events. Please tell an organizer.',
  cancelPublicPostFailed:
    'The event was cancelled, but I could not post the cancellation notice in #events. Please tell an organizer.',
} as const;

export const eventCommand = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Manage Pluto club events.')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Add a manual club event.')
      .addStringOption((option) =>
        option
          .setName('title')
          .setDescription('Event title')
          .setMaxLength(EVENT_TITLE_MAX_LENGTH)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('date')
          .setDescription('Event date in strict YYYY-MM-DD format (e.g. 2026-11-21)')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('time')
          .setDescription('Start time, e.g. 10:00 AM or 4:30 PM (Asia/Kolkata)')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('end')
          .setDescription('Optional end time on the same date, e.g. 11:00 AM or 5:30 PM')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('description')
          .setDescription('Optional event details')
          .setMaxLength(EVENT_DESCRIPTION_MAX_LENGTH)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cancel')
      .setDescription('Cancel a club event by its ID.')
      .addIntegerOption((option) =>
        option
          .setName('id')
          .setDescription('Event ID shown by /upcoming events and in #events')
          .setMinValue(1)
          .setRequired(true),
      ),
  );

export interface EventInteraction {
  isChatInputCommand(): boolean;
  commandName: string;
  guildId: string | null;
  user: { id: string; username?: string };
  memberPermissions?: { has(permission: bigint): boolean } | null;
  options: {
    getSubcommand(required?: boolean): string;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
  };
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  deferReply(options?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

export interface EventCommandDependencies {
  guildId: string;
  events: Pick<EventRepository, 'create' | 'getById' | 'cancel'>;
  /** Posts a public `#events` message with mass mentions disabled. */
  postPublicRecord: (content: string) => Promise<{ messageId?: string } | null>;
  now?: () => Date;
  logger?: DiscordLogger;
}

export type EventCommandResult =
  | 'ignored'
  | 'unsupported-subcommand'
  | 'wrong-guild'
  | 'invalid'
  | 'saved'
  | 'saved-post-failed'
  | 'not-found'
  | 'already-cancelled'
  | 'not-authorized'
  | 'cancelled'
  | 'cancelled-post-failed'
  | 'error';

async function safeReply(
  interaction: EventInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch (error) {
    logger.warn('Failed to send /event reply', { error: errorMessage(error) });
  }
}

async function safeEdit(
  interaction: EventInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.editReply({ content });
  } catch (error) {
    logger.warn('Failed to edit /event reply', { error: errorMessage(error) });
  }
}

export interface EventPresentationInput {
  id: number;
  title: string;
  startAt: Date;
  endAt: Date | null;
  description: string | null;
  organizerUsername?: string;
}

export function formatEventPublicRecord(input: EventPresentationInput): string {
  const title = neutralizeMassMentions(sanitizeInline(input.title));
  const description = input.description
    ? neutralizeMassMentions(sanitizeDescription(input.description))
    : null;
  const lines = [
    `New event: ${title}`,
    `When: ${formatIstRange(input.startAt, input.endAt)}`,
    `Event ID: ${input.id}`,
  ];
  if (description) {
    lines.push('', description);
  }
  if (input.organizerUsername) {
    lines.push('', `Added by ${neutralizeMassMentions(sanitizeInline(input.organizerUsername))}`);
  }
  return fitDiscordContent(lines.join('\n'));
}

export function formatEventConfirmation(
  input: Pick<EventPresentationInput, 'id' | 'title' | 'startAt' | 'endAt'>,
  publicPostSucceeded: boolean,
): string {
  const lines = [
    `Event saved: ${sanitizeInline(input.title)}`,
    `When: ${formatIstRange(input.startAt, input.endAt)}`,
    `Event ID: ${input.id}`,
  ];
  lines.push(
    '',
    publicPostSucceeded
      ? 'A public record was posted in #events.'
      : EVENT_MESSAGES.publicPostFailed,
  );
  return fitDiscordContent(lines.join('\n'));
}

export function formatEventCancelledRecord(
  input: Pick<EventPresentationInput, 'id' | 'title' | 'startAt' | 'endAt'> & {
    cancelledBy?: string;
  },
): string {
  const lines = [
    `Event cancelled: ${neutralizeMassMentions(sanitizeInline(input.title))}`,
    `When: ${formatIstRange(input.startAt, input.endAt)}`,
    `Event ID: ${input.id}`,
  ];
  if (input.cancelledBy) {
    lines.push(
      '',
      `Cancelled by ${neutralizeMassMentions(sanitizeInline(input.cancelledBy))}`,
    );
  }
  return fitDiscordContent(lines.join('\n'));
}

export function formatEventCancellationConfirmation(
  input: Pick<EventPresentationInput, 'id' | 'title' | 'startAt' | 'endAt'>,
  publicPostSucceeded: boolean,
): string {
  const lines = [
    `Event cancelled: ${sanitizeInline(input.title)}`,
    `When: ${formatIstRange(input.startAt, input.endAt)}`,
    `Event ID: ${input.id}`,
  ];
  lines.push(
    '',
    publicPostSucceeded
      ? 'A public cancellation notice was posted in #events.'
      : EVENT_MESSAGES.cancelPublicPostFailed,
  );
  return fitDiscordContent(lines.join('\n'));
}

function readInvalidMessage(
  title: string,
  description: string | null,
): string | null {
  if (!title || title.length > EVENT_TITLE_MAX_LENGTH) {
    return EVENT_MESSAGES.invalidTitle;
  }
  if (
    description !== null &&
    description.length > EVENT_DESCRIPTION_MAX_LENGTH
  ) {
    return EVENT_MESSAGES.invalidDescription;
  }
  return null;
}

async function handleAddEvent(
  interaction: EventInteraction,
  dependencies: EventCommandDependencies,
  logger: DiscordLogger,
): Promise<EventCommandResult> {
  const rawTitle = interaction.options.getString('title', true) ?? '';
  const rawDate = interaction.options.getString('date', true) ?? '';
  const rawTime = interaction.options.getString('time', true) ?? '';
  const rawEnd = interaction.options.getString('end', false);
  const rawDescription = interaction.options.getString('description', false);

  const title = neutralizeMassMentions(sanitizeInline(rawTitle));
  const description = rawDescription?.trim()
    ? neutralizeMassMentions(sanitizeDescription(rawDescription))
    : null;

  const invalid = readInvalidMessage(title, description);
  if (invalid) {
    await safeReply(interaction, invalid, logger);
    return 'invalid';
  }

  const now = dependencies.now?.() ?? new Date();
  const timing = resolveEventTiming(
    { date: rawDate, time: rawTime, end: rawEnd },
    now,
  );
  if (!timing.ok) {
    await safeReply(interaction, timing.message, logger);
    return 'invalid';
  }

  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    logger.error('Failed to acknowledge /event add', {
      error: errorMessage(error),
    });
    return 'error';
  }

  let saved;
  try {
    saved = await dependencies.events.create({
      guildId: dependencies.guildId,
      title,
      description,
      startAt: timing.startAt,
      endAt: timing.endAt,
      timezone: IST_TIMEZONE,
      createdBy: interaction.user.id,
      status: 'scheduled',
    });
  } catch (error) {
    logger.error('Failed to save manual event', {
      error: errorMessage(error),
    });
    await safeEdit(interaction, EVENT_MESSAGES.error, logger);
    return 'error';
  }

  const record = formatEventPublicRecord({
    id: saved.id,
    title,
    startAt: saved.startAt,
    endAt: saved.endAt,
    description,
    organizerUsername: interaction.user.username,
  });

  let publicPostSucceeded = false;
  try {
    await dependencies.postPublicRecord(record);
    publicPostSucceeded = true;
  } catch (error) {
    // Keep the saved row; the contract says the organizer is told the public
    // post failed. No event content is logged.
    logger.warn('Saved manual event but public #events post failed', {
      eventId: saved.id,
      error: errorMessage(error),
    });
  }

  await safeEdit(
    interaction,
    formatEventConfirmation(
      {
        id: saved.id,
        title,
        startAt: saved.startAt,
        endAt: saved.endAt,
      },
      publicPostSucceeded,
    ),
    logger,
  );

  return publicPostSucceeded ? 'saved' : 'saved-post-failed';
}

async function handleCancelEvent(
  interaction: EventInteraction,
  dependencies: EventCommandDependencies,
  logger: DiscordLogger,
): Promise<EventCommandResult> {
  const id = interaction.options.getInteger('id', true);
  if (id === null || !Number.isInteger(id) || id < 1) {
    await safeReply(interaction, EVENT_MESSAGES.invalidId, logger);
    return 'invalid';
  }

  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    logger.error('Failed to acknowledge /event cancel', {
      error: errorMessage(error),
    });
    return 'error';
  }

  let event;
  try {
    event = await dependencies.events.getById(dependencies.guildId, id);
  } catch (error) {
    logger.error('Failed to load event for cancellation', {
      eventId: id,
      error: errorMessage(error),
    });
    await safeEdit(interaction, EVENT_MESSAGES.cancelError, logger);
    return 'error';
  }

  if (!event) {
    await safeEdit(interaction, EVENT_MESSAGES.notFound, logger);
    return 'not-found';
  }
  if (event.status !== 'scheduled') {
    await safeEdit(interaction, EVENT_MESSAGES.alreadyCancelled, logger);
    return 'already-cancelled';
  }

  const canModerate =
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.ManageEvents,
    ) ?? false;
  if (event.createdBy !== interaction.user.id && !canModerate) {
    await safeEdit(interaction, EVENT_MESSAGES.notAllowedToCancel, logger);
    return 'not-authorized';
  }

  let cancelled;
  try {
    cancelled = await dependencies.events.cancel(dependencies.guildId, id);
  } catch (error) {
    logger.error('Failed to cancel manual event', {
      eventId: id,
      error: errorMessage(error),
    });
    await safeEdit(interaction, EVENT_MESSAGES.cancelError, logger);
    return 'error';
  }

  // A concurrent cancellation can win between the read and the conditional
  // update. The loser reports the already-cancelled state and posts nothing.
  if (!cancelled) {
    await safeEdit(interaction, EVENT_MESSAGES.alreadyCancelled, logger);
    return 'already-cancelled';
  }

  const record = formatEventCancelledRecord({
    id: cancelled.id,
    title: cancelled.title,
    startAt: cancelled.startAt,
    endAt: cancelled.endAt,
    cancelledBy: interaction.user.username,
  });

  let publicPostSucceeded = false;
  try {
    await dependencies.postPublicRecord(record);
    publicPostSucceeded = true;
  } catch (error) {
    logger.warn('Cancelled manual event but public #events post failed', {
      eventId: cancelled.id,
      error: errorMessage(error),
    });
  }

  await safeEdit(
    interaction,
    formatEventCancellationConfirmation(
      {
        id: cancelled.id,
        title: cancelled.title,
        startAt: cancelled.startAt,
        endAt: cancelled.endAt,
      },
      publicPostSucceeded,
    ),
    logger,
  );

  return publicPostSucceeded ? 'cancelled' : 'cancelled-post-failed';
}

export async function handleEventInteraction(
  interaction: EventInteraction,
  dependencies: EventCommandDependencies,
): Promise<EventCommandResult> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'event') {
    return 'ignored';
  }

  const logger = dependencies.logger ?? defaultLogger;
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== 'add' && subcommand !== 'cancel') {
    return 'unsupported-subcommand';
  }

  if (interaction.guildId !== dependencies.guildId) {
    await safeReply(interaction, EVENT_MESSAGES.wrongGuild, logger);
    return 'wrong-guild';
  }

  return subcommand === 'add'
    ? handleAddEvent(interaction, dependencies, logger)
    : handleCancelEvent(interaction, dependencies, logger);
}
