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

export type Db = NodePgDatabase<typeof schema>;

export { schema };
