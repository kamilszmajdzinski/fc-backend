// Every product, recipe and change log entry belongs to one user (the Supabase Auth user id).
// Ingredient lines, steps and the price and cost history belong to their product or recipe.
// Existing rows go to LEGACY_OWNER_ID; without it the migration refuses to run on a non-empty database.
// SQLite can't add a NOT NULL column without a default, and rebuilding `recipes` would cascade-delete
// its children, so on SQLite the column defaults to ''. The app always sets it.
// On PostgreSQL, row level security is switched on with no policies: Supabase's public REST API
// (reachable with the anon key the frontend ships) then sees nothing, while the backend, which
// connects as the table owner, is not affected. New tables need the same.
const OWNED_TABLES = ['products', 'recipes', 'change_log'];

export async function up(knex) {
  const legacyOwner = process.env.LEGACY_OWNER_ID || null;
  if (!legacyOwner) {
    for (const table of OWNED_TABLES) {
      if (await knex(table).first('id')) {
        throw new Error(`Table "${table}" has rows. Set LEGACY_OWNER_ID to the user id that should own the existing data.`);
      }
    }
  }

  for (const table of OWNED_TABLES) {
    if (isPostgres(knex)) {
      await knex.raw('alter table ?? add column user_id varchar(64)', [table]);
      if (legacyOwner) await knex(table).update({ user_id: legacyOwner });
      await knex.raw('alter table ?? alter column user_id set not null', [table]);
    } else {
      await knex.raw("alter table ?? add column user_id varchar(64) not null default ''", [table]);
      if (legacyOwner) await knex(table).update({ user_id: legacyOwner });
    }
    await knex.raw('create index ?? on ?? (user_id)', [`${table}_user_id_index`, table]);
  }

  if (isPostgres(knex)) await setRowLevelSecurity(knex, 'enable');
}

export async function down(knex) {
  for (const table of OWNED_TABLES) {
    await knex.raw('drop index ??', [`${table}_user_id_index`]);
    // Native DROP COLUMN; Knex's dropColumn would rebuild `recipes` and cascade-delete its children.
    await knex.raw('alter table ?? drop column user_id', [table]);
  }
  if (isPostgres(knex)) await setRowLevelSecurity(knex, 'disable');
}

function isPostgres(knex) {
  return knex.client.dialect === 'postgresql';
}

async function setRowLevelSecurity(knex, action) {
  const tables = await knex('pg_tables').where('schemaname', 'public').pluck('tablename');
  for (const table of tables) await knex.raw(`alter table ?? ${action} row level security`, [table]);
}
