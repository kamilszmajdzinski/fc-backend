import { createApp } from './app.js';
import { config } from './config.js';
import db from './db/knex.js';

const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (${config.databaseUrl ? 'PostgreSQL' : 'SQLite'})`);
});

async function shutdown() {
  server.close();
  await db.destroy();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
