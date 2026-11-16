import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool } from 'pg';

import * as schema from './schema.js';

const { Pool: PgPool } = pg;

export function createPool(connectionString: string): Pool {
  return new PgPool({ connectionString });
}

export function createDb(connectionString: string) {
  const pool = createPool(connectionString);
  return drizzle(pool, { schema });
}

/**
 * Dedicated read-only database handle for diagnostics and evaluation.
 * The PostgreSQL startup option applies to every connection created by this
 * pool; normal production connections remain unchanged.
 */
export function createReadOnlyPool(connectionString: string): Pool {
  // node-postgres merges parsed connection-string parameters over the explicit
  // pool options. A connection-string `options` value could therefore override
  // the read-only startup option, so reject it before opening any connection.
  if (hasConnectionStringOptions(connectionString)) {
    throw new Error(
      'The dedicated read-only pool does not accept an `options` parameter in ' +
        'DATABASE_URL. Remove `options=` so `default_transaction_read_only=on` ' +
        'cannot be overridden.',
    );
  }
  return new PgPool({
    connectionString,
    // Serialize evaluation queries; every pooled connection still receives the
    // startup read-only option.
    max: 1,
    options: '-c default_transaction_read_only=on',
  });
}

export async function createReadOnlyDb(connectionString: string) {
  const pool = createReadOnlyPool(connectionString);
  try {
    return drizzle(pool, { schema });
  } catch (error) {
    try {
      await pool.end();
    } catch {
      // Preserve the original Drizzle construction error.
    }
    throw error;
  }
}

function hasConnectionStringOptions(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === 'options')) {
      return true;
    }
  } catch {
    // Fall through for libpq-style key/value connection strings.
  }
  return /(?:^|\s)options\s*=/i.test(connectionString);
}

export type Db = NodePgDatabase<typeof schema>;

export { schema };
