// Replaces the catalog with the current Frisco feed, in the database from .env / DATABASE_URL.
// Usage: npm run catalog:import               (downloads the feed, ~60 MB)
//        npm run catalog:import -- --file f.json  (uses a feed saved earlier)
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import db from '../src/db/knex.js';
import { downloadFeed, importCatalog } from '../src/modules/catalog/catalog.import.js';

const { values } = parseArgs({ options: { file: { type: 'string' } } });

try {
  console.log(values.file ? `Reading ${values.file}` : 'Downloading the Frisco feed');
  const feed = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : await downloadFeed();
  const result = await importCatalog(db, feed);
  console.log(`Imported ${result.productCount} products and ${result.categoryCount} categories (feed generated ${result.generatedAt})`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
