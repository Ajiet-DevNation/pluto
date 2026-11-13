import { CitationError } from './types';
import { requirePattern } from './validate';
import type { CitationPolicy, DiscordMessageCitation } from './types';

/** Discord snowflakes are 17-20 digits today; allow a generous range. */
const SNOWFLAKE = /^\d{5,25}$/;

export function discordMessageUrl(
  citation: DiscordMessageCitation,
  policy: CitationPolicy = {},
): string {
  const guildId = requirePattern(citation.guildId, SNOWFLAKE, 'guildId');
  const channelId = requirePattern(citation.channelId, SNOWFLAKE, 'channelId');
  const messageId = requirePattern(citation.messageId, SNOWFLAKE, 'messageId');

  if (policy.blockedChannelIds?.includes(channelId)) {
    throw new CitationError(
      `Refusing to cite channel ${channelId}: it is a blocked output channel, not a source`,
    );
  }

  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
