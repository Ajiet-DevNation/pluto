/**
 * Shared Discord types for P1.
 *
 * The intake layer is deliberately expressed with a narrow structural message
 * type so it can be unit-tested without a live gateway connection. discord.js
 * `Message` objects satisfy these shapes.
 */

export interface AuthoredMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  system: boolean;
  content: string;
  createdAt: Date;
  author: {
    id: string;
    bot: boolean;
  };
}

export interface DiscordIndexRecord {
  sourceType: 'discord';
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  /**
   * Only non-bot messages are admitted by intake. The flag is stored so the
   * retrieval/citation layer can independently reject a bot-authored record
   * if one ever reaches the store by another path.
   */
  authorIsBot: boolean;
  content: string;
  createdAt: string;
  indexedAt: string;
  sourceUrl: string;
}

export interface DiscordIndexStore {
  upsert(record: DiscordIndexRecord): Promise<void>;
  /** Remove every record for an author after opt-out. Returns the count removed. */
  removeAuthor(guildId: string, authorId: string): Promise<number>;
  getLastMessageId(guildId: string, channelId: string): Promise<string | null>;
  setLastMessageId(guildId: string, channelId: string, messageId: string): Promise<void>;
  /** Read-only view used by verification and by the retrieval layer. */
  listRecords(): Promise<DiscordIndexRecord[]>;
}

export interface OptOutStore {
  isOptedOut(guildId: string, userId: string): Promise<boolean>;
  optOut(guildId: string, userId: string, optedOutBy: string): Promise<void>;
  optIn(guildId: string, userId: string): Promise<void>;
}

export interface DiscordLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export const defaultLogger: DiscordLogger = {
  info(message, details) {
    console.log(message, details ?? '');
  },
  warn(message, details) {
    console.warn(message, details ?? '');
  },
  error(message, details) {
    console.error(message, details ?? '');
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
