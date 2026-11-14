/**
 * Discord persistence.
 *
 * P1 deliberately keeps storage behind the shared interfaces so the search /
 * Neon layer can replace the implementation without touching intake, commands
 * or tests. The default implementation is an atomic JSON file. The default
 * location is outside the repository (PLUTO_DATA_DIR or ~/.pluto) so runtime
 * state is never committed and no extra .gitignore entry is required.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type {
  DiscordIndexRecord,
  DiscordIndexStore,
  OptOutStore,
} from './types';
import { errorMessage } from './types';

interface OptOutEntry {
  optedOutAt: string;
  optedOutBy: string;
}

interface StateFileV1 {
  version: 1;
  records: DiscordIndexRecord[];
  cursors: Record<string, string>;
  optouts: Record<string, OptOutEntry>;
}

function emptyState(): StateFileV1 {
  return { version: 1, records: [], cursors: {}, optouts: {} };
}

function stateKey(guildId: string, id: string): string {
  return `${guildId}:${id}`;
}

export class JsonDiscordStore implements DiscordIndexStore, OptOutStore {
  private state: StateFileV1 = emptyState();

  private loaded = false;

  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StateFileV1>;
      this.state = {
        version: 1,
        records: Array.isArray(parsed.records) ? parsed.records : [],
        cursors:
          parsed.cursors && typeof parsed.cursors === 'object' ? parsed.cursors : {},
        optouts:
          parsed.optouts && typeof parsed.optouts === 'object' ? parsed.optouts : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Failed to load Discord state from ${this.filePath}: ${errorMessage(error)}`,
        );
      }
      this.state = emptyState();
    }

    this.loaded = true;
  }

  private async save(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }

  private withState<T>(task: () => Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      return task();
    });
  }

  async upsert(record: DiscordIndexRecord): Promise<void> {
    if (record.authorIsBot) {
      throw new Error('Refusing to store a bot-authored Discord record');
    }
    await this.withState(async () => {
      const index = this.state.records.findIndex(
        (existing) =>
          existing.sourceType === record.sourceType &&
          existing.messageId === record.messageId,
      );
      if (index >= 0) {
        this.state.records[index] = record;
      } else {
        this.state.records.push(record);
      }
      await this.save();
    });
  }

  async removeAuthor(guildId: string, authorId: string): Promise<number> {
    return this.withState(async () => {
      const before = this.state.records.length;
      this.state.records = this.state.records.filter(
        (record) => !(record.guildId === guildId && record.authorId === authorId),
      );
      const removed = before - this.state.records.length;
      if (removed > 0) {
        await this.save();
      }
      return removed;
    });
  }

  async getLastMessageId(guildId: string, channelId: string): Promise<string | null> {
    return this.withState(async () => this.state.cursors[stateKey(guildId, channelId)] ?? null);
  }

  async setLastMessageId(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.withState(async () => {
      this.state.cursors[stateKey(guildId, channelId)] = messageId;
      await this.save();
    });
  }

  async listRecords(): Promise<DiscordIndexRecord[]> {
    return this.withState(async () => this.state.records.map((record) => ({ ...record })));
  }

  async isOptedOut(guildId: string, userId: string): Promise<boolean> {
    return this.withState(async () => Boolean(this.state.optouts[stateKey(guildId, userId)]));
  }

  async optOut(guildId: string, userId: string, optedOutBy: string): Promise<void> {
    await this.withState(async () => {
      const key = stateKey(guildId, userId);
      if (this.state.optouts[key]) {
        return;
      }
      this.state.optouts[key] = {
        optedOutAt: new Date().toISOString(),
        optedOutBy,
      };
      await this.save();
    });
  }

  async optIn(guildId: string, userId: string): Promise<void> {
    await this.withState(async () => {
      const key = stateKey(guildId, userId);
      if (!this.state.optouts[key]) {
        return;
      }
      Reflect.deleteProperty(this.state.optouts, key);
      await this.save();
    });
  }
}

/**
 * In-memory implementation used by unit tests and by short-lived dev runs.
 * Production uses JsonDiscordStore.
 */
export class InMemoryDiscordStore implements DiscordIndexStore, OptOutStore {
  private records: DiscordIndexRecord[] = [];

  private cursors = new Map<string, string>();

  private optouts = new Set<string>();

  async upsert(record: DiscordIndexRecord): Promise<void> {
    if (record.authorIsBot) {
      throw new Error('Refusing to store a bot-authored Discord record');
    }
    const index = this.records.findIndex(
      (existing) =>
        existing.sourceType === record.sourceType &&
        existing.messageId === record.messageId,
    );
    if (index >= 0) {
      this.records[index] = record;
    } else {
      this.records.push(record);
    }
  }

  async removeAuthor(guildId: string, authorId: string): Promise<number> {
    const before = this.records.length;
    this.records = this.records.filter(
      (record) => !(record.guildId === guildId && record.authorId === authorId),
    );
    return before - this.records.length;
  }

  async getLastMessageId(guildId: string, channelId: string): Promise<string | null> {
    return this.cursors.get(stateKey(guildId, channelId)) ?? null;
  }

  async setLastMessageId(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    this.cursors.set(stateKey(guildId, channelId), messageId);
  }

  async listRecords(): Promise<DiscordIndexRecord[]> {
    return this.records.map((record) => ({ ...record }));
  }

  async isOptedOut(guildId: string, userId: string): Promise<boolean> {
    return this.optouts.has(stateKey(guildId, userId));
  }

  async optOut(guildId: string, userId: string): Promise<void> {
    this.optouts.add(stateKey(guildId, userId));
  }

  async optIn(guildId: string, userId: string): Promise<void> {
    const key = stateKey(guildId, userId);
    this.optouts = new Set([...this.optouts].filter((entry) => entry !== key));
  }
}

export function defaultStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PLUTO_DATA_DIR?.trim();
  const directory = configured && configured.length > 0
    ? configured
    : join(homedir(), '.pluto');
  return resolve(directory, 'discord-state.json');
}

export function createDefaultStore(env: NodeJS.ProcessEnv = process.env): JsonDiscordStore {
  return new JsonDiscordStore(defaultStatePath(env));
}
