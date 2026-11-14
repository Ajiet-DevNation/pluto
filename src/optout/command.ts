/**
 * /optout — member self-service opt-out.
 *
 * Opt-out is recorded first. Existing records are then purged from Pluto's
 * index; the retrieval layer also filters opted-out authors, so a purge failure
 * does not expose opted-out content.
 */

import type {
  DiscordIndexStore,
  DiscordLogger,
  OptOutStore,
} from '../discord/types';
import { defaultLogger, errorMessage } from '../discord/types';

export const OPTOUT_MESSAGES = {
  wrongGuild: 'This command works only inside the DevNation server.',
  optedOut: "You're opted out. Pluto will not index or cite your messages.",
  already: "You're already opted out.",
  error:
    'Something went wrong. Your opt-out status was not changed. Please try again.',
} as const;

export interface OptOutInteraction {
  isChatInputCommand(): boolean;
  commandName: string;
  guildId: string | null;
  user: { id: string };
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
}

export interface OptOutDependencies {
  guildId: string;
  optOutStore: OptOutStore;
  indexStore: DiscordIndexStore;
  logger?: DiscordLogger;
}

export type OptOutResult =
  | 'ignored'
  | 'wrong-guild'
  | 'opted-out'
  | 'already-opted-out'
  | 'error';

async function safeReply(
  interaction: OptOutInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch (error) {
    logger.warn('Failed to send opt-out reply', { error: errorMessage(error) });
  }
}

export async function handleOptOutInteraction(
  interaction: OptOutInteraction,
  dependencies: OptOutDependencies,
): Promise<OptOutResult> {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'optout'
  ) {
    return 'ignored';
  }

  const logger = dependencies.logger ?? defaultLogger;

  if (interaction.guildId !== dependencies.guildId) {
    await safeReply(interaction, OPTOUT_MESSAGES.wrongGuild, logger);
    return 'wrong-guild';
  }

  try {
    const alreadyOptedOut = await dependencies.optOutStore.isOptedOut(
      dependencies.guildId,
      interaction.user.id,
    );

    if (!alreadyOptedOut) {
      await dependencies.optOutStore.optOut(
        dependencies.guildId,
        interaction.user.id,
        interaction.user.id,
      );
    }

    try {
      await dependencies.indexStore.removeAuthor(
        dependencies.guildId,
        interaction.user.id,
      );
    } catch (error) {
      logger.warn('Opt-out recorded but existing records could not be purged', {
        userId: interaction.user.id,
        error: errorMessage(error),
      });
    }

    await interaction.reply({
      content: alreadyOptedOut ? OPTOUT_MESSAGES.already : OPTOUT_MESSAGES.optedOut,
      ephemeral: true,
    });

    return alreadyOptedOut ? 'already-opted-out' : 'opted-out';
  } catch (error) {
    logger.error('Opt-out failed', {
      userId: interaction.user.id,
      error: errorMessage(error),
    });
    await safeReply(interaction, OPTOUT_MESSAGES.error, logger);
    return 'error';
  }
}
