// Soft delete for recipes, plus two new allowed values: change log action 'restored' and
// cost history reason 'recipe_restored'. Allowed values are CHECK constraints, which PostgreSQL
// can replace in place but SQLite can only change by rebuilding the table.
const CHANGE_ACTIONS = ['created', 'updated', 'deleted'];
const COST_REASONS = ['created', 'recipe_updated', 'product_price_changed'];

export async function up(knex) {
  await knex.schema.alterTable('recipes', (table) => {
    table.timestamp('deleted_at');
  });
  await replaceAllowedValues(knex, 'change_log', 'action', CHANGE_ACTIONS, [...CHANGE_ACTIONS, 'restored']);
  await replaceAllowedValues(knex, 'recipe_cost_history', 'reason', COST_REASONS, [...COST_REASONS, 'recipe_restored']);
}

export async function down(knex) {
  await knex('change_log').where('action', 'restored').update({ action: 'updated' });
  await knex('recipe_cost_history').where('reason', 'recipe_restored').update({ reason: 'recipe_updated' });
  await replaceAllowedValues(knex, 'change_log', 'action', [...CHANGE_ACTIONS, 'restored'], CHANGE_ACTIONS);
  await replaceAllowedValues(knex, 'recipe_cost_history', 'reason', [...COST_REASONS, 'recipe_restored'], COST_REASONS);

  // Without deleted_at, soft-deleted recipes would reappear, so delete them for real as before.
  await knex('recipes').whereNotNull('deleted_at').del();
  // Native DROP COLUMN: Knex's dropColumn rebuilds `recipes` on SQLite, and dropping the old
  // table would cascade-delete ingredients, steps and cost history.
  await knex.raw('alter table recipes drop column deleted_at');
}

function inList(values) {
  return values.map((value) => `'${value}'`).join(', ');
}

async function replaceAllowedValues(knex, table, column, oldValues, newValues) {
  if (knex.client.dialect === 'postgresql') {
    const constraints = await knex('pg_constraint')
      .where('conrelid', knex.raw('?::regclass', [table]))
      .andWhere('contype', 'c')
      .andWhereRaw('pg_get_constraintdef(oid) like ?', [`%${column}%`])
      .pluck('conname');
    for (const name of constraints) {
      await knex.raw('alter table ?? drop constraint ??', [table, name]);
    }
    await knex.raw(`alter table ?? add constraint ?? check (?? in (${inList(newValues)}))`, [table, `${table}_${column}_check`, column]);
    return;
  }

  await rebuildSqliteTable(knex, table, (sql) => {
    const oldCheck = `in (${inList(oldValues)})`;
    if (!sql.includes(oldCheck)) throw new Error(`Unexpected definition of ${table}: ${sql}`);
    return sql.replace(oldCheck, `in (${inList(newValues)})`);
  });
}

// Rebuilds a table from its own stored definition: create a copy with the changed definition,
// copy the rows, drop the original, rename the copy and recreate the indexes. Only safe for
// tables that no other table references: dropping the original runs its ON DELETE actions.
// The self-reference in change_log points at the copy and is renamed along with it.
async function rebuildSqliteTable(knex, table, changeDefinition) {
  const { sql } = await knex('sqlite_master').where({ type: 'table', name: table }).first('sql');
  const indexes = await knex('sqlite_master').where({ type: 'index', tbl_name: table }).whereNotNull('sql').pluck('sql');
  const copy = `${table}_rebuild`;
  // Knex writes `name`; after an earlier rebuild SQLite stores the renamed table as "name".
  const tableName = new RegExp(`[\`"]${table}[\`"]`, 'g');

  await knex.raw(changeDefinition(sql).replace(tableName, `\`${copy}\``));
  await knex.raw(`insert into \`${copy}\` select * from \`${table}\``);
  await knex.raw(`drop table \`${table}\``);
  await knex.raw(`alter table \`${copy}\` rename to \`${table}\``);
  for (const indexSql of indexes) await knex.raw(indexSql);
}
