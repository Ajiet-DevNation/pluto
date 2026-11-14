#!/usr/bin/env tsx
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    // Ensure the schema_migrations tracking table exists.
    // This makes re-runs idempotent: already-applied files are skipped.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const migrationsDir = path.join(process.cwd(), 'drizzle/migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    console.log(`Found ${files.length} migration file(s).`);

    for (const file of files) {
      // Check if this migration was already applied.
      const already = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if (already.rows.length > 0) {
        console.log(`Skipping ${file} (already applied).`);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

      console.log(`Running migration: ${file} (${statements.length} statement(s)...`);
      for (const stmt of statements) {
        if (stmt.trim()) {
          await pool.query(stmt);
        }
      }

      // Record the migration as applied.
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
        [file]
      );
      console.log(`Migration ${file} complete.`);
    }

    console.log('All migrations complete.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
