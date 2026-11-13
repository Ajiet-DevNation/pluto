import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createJobQueue } from '../../src/jobs/index.js';

describe('job queue', () => {
  it('creates a pg-boss instance', () => {
    const boss = createJobQueue('postgresql://localhost:5432/pluto');
    assert.ok(boss);
    assert.strictEqual(typeof boss.start, 'function');
    assert.strictEqual(typeof boss.on, 'function');
  });
});
