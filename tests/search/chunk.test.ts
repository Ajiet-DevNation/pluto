import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordSearchChunk,
  buildGithubCommitChunks,
  buildGithubFileChunks,
  buildGithubIssueChunks,
  buildGithubPullRequestChunks,
  buildGithubReadmeChunks,
  chunkText,
} from '../../src/search/chunk';
import { makeRecord } from '../discord/helpers';

test('short text stays as one trimmed chunk', () => {
  assert.deepEqual(chunkText('  one project update  '), ['one project update']);
});

test('empty text produces no chunks', () => {
  assert.deepEqual(chunkText('   \n\t '), []);
});

test('long text splits on word boundaries with overlap', () => {
  const text = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');
  const chunks = chunkText(text, 240, 40);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 240, `chunk too long: ${chunk.length}`);
    assert.ok(!chunk.startsWith(' '));
    assert.ok(!chunk.endsWith(' '));
    assert.ok(chunk.startsWith('word'), `chunk started mid-word: ${chunk.slice(0, 20)}`);
  }
});

test('invalid chunk configuration fails closed', () => {
  assert.throws(() => chunkText('x', 0), /maxChars/);
  assert.throws(() => chunkText('x', 10, 10), /overlapChars/);
});

test('Discord records become one search chunk with source metadata', () => {
  const record = makeRecord();
  const chunk = buildDiscordSearchChunk(record);

  assert.equal(chunk.sourceType, 'discord');
  assert.equal(chunk.sourceId, record.messageId);
  assert.equal(chunk.chunkIndex, 0);
  assert.equal(chunk.channelId, record.channelId);
  assert.equal(chunk.authorId, record.authorId);
  assert.equal(chunk.sourceUrl, record.sourceUrl);
  assert.equal(chunk.content, record.content);
});

test('bot-authored records are never turned into search chunks', () => {
  assert.throws(
    () => buildDiscordSearchChunk(makeRecord({ authorIsBot: true })),
    /Refusing to build a search chunk for bot/,
  );
});

test('GitHub issues produce citable chunks with a stable source id', () => {
  const chunks = buildGithubIssueChunks({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    issueNumber: 9,
    title: 'P1: Discord allowlist indexing',
    body: 'Index only the allowlisted channels.',
    state: 'closed',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/pull/9',
  });

  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].sourceType, 'github');
  assert.equal(chunks[0].sourceId, 'Ajiet-DevNation/pluto#9');
  assert.equal(chunks[0].sourceUrl, 'https://github.com/Ajiet-DevNation/pluto/pull/9');
  assert.match(chunks[0].content, /Discord allowlist indexing/);
  assert.match(chunks[0].content, /allowlisted channels/);
});

test('GitHub pull requests and commits produce citable chunks', () => {
  const pullRequest = buildGithubPullRequestChunks({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    number: 9,
    title: 'P1: Discord allowlist indexing',
    body: 'Merged P1.',
    state: 'closed',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/pull/9',
    mergedAt: '2026-11-14T07:25:17Z',
  });
  const commit = buildGithubCommitChunks({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    sha: '823d07c1a3e',
    message: 'feat(p2): add /ask',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/commit/823d07c1a3e',
    date: '2026-11-14T08:00:00Z',
  });

  assert.equal(pullRequest[0].sourceId, 'Ajiet-DevNation/pluto#pr-9');
  assert.match(pullRequest[0].content, /Merged: 2026-11-14/);
  assert.equal(commit[0].sourceId, 'Ajiet-DevNation/pluto@823d07c1a3e');
  assert.match(commit[0].content, /feat\(p2\)/);
});

test('GitHub README content is chunked and cited to its repository URL', () => {
  const chunks = buildGithubReadmeChunks({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    path: 'README.md',
    content: '# Pluto\nA read-only knowledge assistant.',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md',
    description: 'Knowledge assistant',
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sourceType, 'github');
  assert.equal(chunks[0].sourceId, 'Ajiet-DevNation/pluto#readme');
  assert.equal(chunks[0].sourceUrl, 'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md');
  assert.match(chunks[0].content, /read-only knowledge assistant/);
  assert.match(chunks[0].content, /Repository description: Knowledge assistant/);
});

test('GitHub source files get stable ids and real blob citations', () => {
  const chunks = buildGithubFileChunks({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    path: 'src/search.ts',
    content: 'export const answer = 42;',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/blob/main/src/search.ts',
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sourceId.length < 255, true);
  assert.equal(chunks[0].sourceUrl, 'https://github.com/Ajiet-DevNation/pluto/blob/main/src/search.ts');
  assert.match(chunks[0].content, /src\/search.ts/);
  assert.match(chunks[0].content, /export const answer = 42/);
});
