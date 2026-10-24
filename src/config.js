import { existsSync } from 'node:fs';
import path from 'node:path';

export const rootDir = path.resolve(import.meta.dirname, '..');

const envFile = path.join(rootDir, '.env');
if (process.env.NODE_ENV !== 'test' && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function parseCorsOrigin(value) {
  if (!value || value.trim() === '*') return '*';
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  // Empty -> local SQLite file. postgres://... -> PostgreSQL (e.g. Supabase).
  databaseUrl: process.env.DATABASE_URL || null,
  databaseSsl: process.env.DATABASE_SSL !== 'false',
  // Supabase project URL, e.g. https://abcd.supabase.co. API requests must carry a token it issued.
  supabaseUrl: process.env.SUPABASE_URL || null,
  sqliteFile: path.join(rootDir, 'data', 'dev.sqlite3'),
};
