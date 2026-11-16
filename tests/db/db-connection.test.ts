import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDb, createReadOnlyPool } from '../../src/db/index.js';

describe('database connection', () => {
  it('creates a drizzle db instance from a connection string', () => {
    const db = createDb('postgresql://localhost:5432/pluto');
    assert.ok(db);
  });

  it('rejects URL-provided options for the read-only pool', () => {
    assert.throws(
      () =>
        createReadOnlyPool(
          'postgresql://user:pass@localhost:5432/pluto?options=-c%20default_transaction_read_only%3Doff',
        ),
      /options/i,
    );
    assert.throws(
      () =>
        createReadOnlyPool(
          'host=localhost dbname=pluto options=-c default_transaction_read_only=off',
        ),
      /options/i,
    );
  });
});
