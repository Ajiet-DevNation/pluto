import { createPool } from '../db/index.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

/**
 * Isolated Drizzle handle for the meeting_events table.
 *
 * Reuses the shared node-postgres pool factory but scopes the Drizzle instance
 * to the announcer schema so L3-owned code does not rewrite shared schema.ts.
 * Khushi may later merge this table into src/db/schema.ts.
 */
export function createMeetingDb(connectionString: string) {
  const pool = createPool(connectionString);
  return drizzle(pool, { schema });
}

export type MeetingDb = NodePgDatabase<typeof schema>;

export { schema as meetingSchema };
