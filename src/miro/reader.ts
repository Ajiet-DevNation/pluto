import { createReadOnlyGuard } from '../guardrails/read-only';

/**
 * Read-only Miro client.
 *
 * Miro MCP server connection details and a board allowlist do not exist yet, so
 * this module talks to the read-only REST API (`GET` only) and is verified with
 * mocked transport. Live verification is recorded as pending in STATE.md.
 *
 * A missing token throws. Returning an empty list when unconfigured would be
 * indistinguishable from a board with no items.
 */

export class MiroNotConfiguredError extends Error {
  constructor(message = 'Miro access is not configured: set MIRO_ACCESS_TOKEN') {
    super(message);
    this.name = 'MiroNotConfiguredError';
  }
}

export class MiroReadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'MiroReadError';
    this.status = status;
  }
}

export interface MiroBoard {
  id: string;
  name: string;
  viewLink: string;
}

export interface MiroItem {
  id: string;
  type: string;
  boardId: string;
}

export interface MiroReader {
  listBoards(): Promise<MiroBoard[]>;
  getBoard(boardId: string): Promise<MiroBoard>;
  listBoardItems(boardId: string): Promise<MiroItem[]>;
}

export const MIRO_READ_METHODS = ['listBoards', 'getBoard', 'listBoardItems'] as const;

export interface MiroReaderOptions {
  token: string;
  /** Override for tests. Defaults to https://api.miro.com */
  baseUrl?: string;
  /** Inject for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

interface RawBoard {
  id: string;
  name: string;
  viewLink?: string;
}

interface RawBoardList {
  data?: RawBoard[];
}

interface RawItem {
  id: string;
  type: string;
}

interface RawItemList {
  data?: RawItem[];
}

function toBoard(raw: RawBoard): MiroBoard {
  return {
    id: raw.id,
    name: raw.name,
    viewLink: raw.viewLink ?? `https://miro.com/app/board/${raw.id}/`,
  };
}

function encodeSegment(value: string, label: string): string {
  if (!value || !value.trim()) {
    throw new MiroReadError(`Invalid ${label}: value is empty`);
  }
  return encodeURIComponent(value.trim());
}

export function createMiroReader(options: MiroReaderOptions): MiroReader {
  const token = options.token?.trim();
  if (!token) {
    throw new MiroNotConfiguredError();
  }

  const baseUrl = (options.baseUrl ?? 'https://api.miro.com').replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'pluto-readonly';

  /**
   * The only outbound call in this module. Method is fixed to GET.
   */
  async function getJson<T>(path: string): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      throw new MiroReadError(
        `Miro read failed: ${path} returned ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  const reader: MiroReader = {
    async listBoards(): Promise<MiroBoard[]> {
      const raw = await getJson<RawBoardList>('/v2/boards?limit=50');
      return (raw.data ?? []).map(toBoard);
    },

    async getBoard(boardId: string): Promise<MiroBoard> {
      const path = `/v2/boards/${encodeSegment(boardId, 'boardId')}`;
      return toBoard(await getJson<RawBoard>(path));
    },

    async listBoardItems(boardId: string): Promise<MiroItem[]> {
      const path = `/v2/boards/${encodeSegment(boardId, 'boardId')}/items?limit=50`;
      const raw = await getJson<RawItemList>(path);
      return (raw.data ?? []).map((item) => ({
        id: item.id,
        type: item.type,
        boardId,
      }));
    },
  };

  return createReadOnlyGuard<MiroReader>(MIRO_READ_METHODS, {
    context: 'MiroReader',
  })(reader);
}

/**
 * Build a Miro reader from the environment.
 * Throws MiroNotConfiguredError when MIRO_ACCESS_TOKEN is absent.
 */
export function createMiroReaderFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Omit<MiroReaderOptions, 'token'> = {},
): MiroReader {
  return createMiroReader({ token: env.MIRO_ACCESS_TOKEN ?? '', ...overrides });
}
