// Used by the Knex CLI (npm run migrate / seed). The app builds the same config in src/db/knex.js.
import { buildKnexConfig } from './src/db/knexConfig.js';

export default buildKnexConfig();
