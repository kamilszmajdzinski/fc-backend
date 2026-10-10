import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const dbDir = import.meta.dirname;

const common = {
  migrations: { directory: path.join(dbDir, 'migrations') },
  seeds: { directory: path.join(dbDir, 'seeds') },
};

// Runs for every new SQLite connection:
// - SQLite ignores foreign keys unless they are switched on per connection.
// - The built-in lower() only handles ASCII, so searches for "śmietanka" would never match
//   "Śmietanka". Replace it with JavaScript's Unicode-aware version (PostgreSQL needs nothing).
function prepareSqliteConnection(connection, done) {
  connection.pragma('foreign_keys = ON');
  connection.function('lower', { deterministic: true }, (value) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );
  done();
}

export function buildKnexConfig() {
  if (config.env === 'test') {
    return {
      ...common,
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      // One connection that is never released, so the in-memory database lives for the whole test file.
      pool: { min: 1, max: 1, idleTimeoutMillis: Number.MAX_SAFE_INTEGER, afterCreate: prepareSqliteConnection },
    };
  }

  if (config.databaseUrl) {
    return {
      ...common,
      client: 'pg',
      connection: {
        connectionString: config.databaseUrl,
        ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      },
      pool: { min: 0, max: 10 },
    };
  }

  mkdirSync(path.dirname(config.sqliteFile), { recursive: true });
  return {
    ...common,
    client: 'better-sqlite3',
    connection: { filename: config.sqliteFile },
    useNullAsDefault: true,
    pool: { afterCreate: prepareSqliteConnection },
  };
}
