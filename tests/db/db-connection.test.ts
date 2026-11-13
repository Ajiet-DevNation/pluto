import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDb } from '../../src/db/index.js';

describe('database connection', () => {
  it('creates a drizzle db instance from a connection string', () => {
    const db = createDb('postgresql://localhost:5432/pluto');
    assert.ok(db);
  });
});
