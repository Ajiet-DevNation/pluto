import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDiscordGuildId,
  getDiscordOutputChannelId,
  getExcludedChannels,
  getGitHubOrg,
  getIndexedChannels,
} from '../../src/config';

test('config getters read the planning section used by the repository', () => {
  assert.equal(getGitHubOrg(), 'Ajiet-DevNation');
  assert.equal(getDiscordGuildId(), '1422593925658579036');
  assert.equal(getDiscordOutputChannelId(), '1570721649538502686');

  const indexed = getIndexedChannels();
  assert.deepEqual(Object.keys(indexed).sort(), [
    '#announcements',
    '#meeting-plans',
    '#project-stack',
    '#resources',
  ]);
  assert.equal(indexed['#project-stack'], '1423323863093088407');

  const excluded = getExcludedChannels();
  assert.ok(excluded.includes('#pluto'));
  assert.ok(excluded.includes('#off-topic'));
});
