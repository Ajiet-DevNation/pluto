import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDiscordEventsChannelId,
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
  assert.equal(getDiscordEventsChannelId(), '1572348309509644289');

  const indexed = getIndexedChannels();
  assert.deepEqual(Object.keys(indexed).sort(), [
    '#announcements',
    '#decisions',
    '#meeting-plans',
    '#project-stack',
    '#resources',
  ]);
  assert.equal(indexed['#project-stack'], '1423323863093088407');
  assert.equal(indexed['#decisions'], '1571564343995277492');
  assert.equal(Object.values(indexed).includes('1572348309509644289'), false);

  const excluded = getExcludedChannels();
  assert.ok(excluded.includes('#pluto'));
  assert.ok(excluded.includes('#events'));
  assert.ok(excluded.includes('#off-topic'));
});
