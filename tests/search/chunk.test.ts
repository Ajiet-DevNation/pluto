import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordSearchChunk,
  buildGithubIssueChunks,
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
