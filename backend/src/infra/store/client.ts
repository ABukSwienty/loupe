import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as sqliteVec from 'sqlite-vec';
import * as schema from './schema/index.js';

export type Store = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

// Same relative path from src/infra/store and dist/infra/store.
const migrationsFolder = fileURLToPath(
  new URL('../../../drizzle', import.meta.url),
);

/** Opens the database, loads sqlite-vec and applies pending migrations. */
export function openStore(path: string): Store {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  // WAL lets readers (including other processes) run while a write is in progress.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqliteVec.load(sqlite);

  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder });
  return db;
}
