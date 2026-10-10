import knex from 'knex';
import { buildKnexConfig } from './knexConfig.js';

const db = knex(buildKnexConfig());

export default db;
