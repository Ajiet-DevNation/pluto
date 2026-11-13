import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMiroReader,
  createMiroReaderFromEnv,
  MiroNotConfiguredError,
  MiroReadError,
} from '../../src/miro/reader';
import { ReadOnlyViolation } from '../../src/guardrails/read-only';

interface RecordedCall {
  url: string;
  method: string | undefined;
}

function fakeFetch(payload: unknown, status = 200) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('listBoards issues a GET and maps boards', async () => {
  const { impl, calls } = fakeFetch({
    data: [
      { id: 'uXjVH8abc=', name: 'DevNation Roadmap' },
      { id: 'uXjVH9def=', name: 'Event Ideas', viewLink: 'https://miro.com/app/board/uXjVH9def=/' },
    ],
  });
  const reader = createMiroReader({ token: 'miro-token', fetchImpl: impl });

  const boards = await reader.listBoards();

  assert.equal(boards.length, 2);
  assert.equal(boards[0].name, 'DevNation Roadmap');
  assert.equal(boards[0].viewLink, 'https://miro.com/app/board/uXjVH8abc=/');
  assert.equal(boards[1].viewLink, 'https://miro.com/app/board/uXjVH9def=/');
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/v2\/boards\?limit=50$/);
});

test('listBoardItems maps items onto the board', async () => {
  const { impl } = fakeFetch({
    data: [
      { id: '3458764513820540928', type: 'sticky_note' },
      { id: '3458764513820540929', type: 'text' },
    ],
  });
  const reader = createMiroReader({ token: 't', fetchImpl: impl });

  const items = await reader.listBoardItems('uXjVH8abc=');

  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'sticky_note');
  assert.equal(items[0].boardId, 'uXjVH8abc=');
});

test('getBoard encodes the board id', async () => {
  const { impl, calls } = fakeFetch({ id: 'uXjVH8abc=', name: 'Board' });
  const reader = createMiroReader({ token: 't', fetchImpl: impl });

  await reader.getBoard('uXjVH8abc=');

  assert.equal(calls[0].url, 'https://api.miro.com/v2/boards/uXjVH8abc%3D');
});

test('non-2xx responses throw MiroReadError with the status', async () => {
  const { impl } = fakeFetch({ message: 'Unauthorized' }, 401);
  const reader = createMiroReader({ token: 't', fetchImpl: impl });

  await assert.rejects(
    () => reader.listBoards(),
    (error: unknown) => {
      assert.ok(error instanceof MiroReadError);
      assert.equal(error.status, 401);
      return true;
    },
  );
});

test('rejects write methods through the guard', () => {
  const { impl } = fakeFetch({ data: [] });
  const reader = createMiroReader({ token: 't', fetchImpl: impl });

  assert.throws(
    () => (reader as unknown as Record<string, unknown>)['createBoard'],
    ReadOnlyViolation,
  );
  assert.throws(
    () => (reader as unknown as Record<string, unknown>)['updateItem'],
    ReadOnlyViolation,
  );
});

test('throws MiroNotConfiguredError when no token is present', () => {
  assert.throws(() => createMiroReader({ token: '' }), MiroNotConfiguredError);
  assert.throws(() => createMiroReaderFromEnv({}), MiroNotConfiguredError);
});
