// Recipes as ingredients of other recipes ("sub-recipes"):
// - recipes get an optional yield (e.g. 550 g), so a sub-recipe can be measured by weight or volume;
// - an ingredient line points at a product OR a sub-recipe, and may use the new unit 'portion';
// - cost history gets reason 'sub_recipe_changed' and a link to the sub-recipe behind a change.
// SQLite can't relax NOT NULL or change CHECK constraints in place, so on SQLite the two tables
// are rebuilt from explicit definitions. Nothing references either table, so this is safe.
const PRODUCT_UNITS = ['mg', 'g', 'kg', 'ml', 'l', 'piece'];
const YIELD_UNITS = ['mg', 'g', 'kg', 'ml', 'l'];
const COST_REASONS = ['created', 'recipe_updated', 'product_price_changed', 'recipe_restored'];

export async function up(knex) {
  await knex.schema.alterTable('recipes', (table) => {
    table.double('yield_quantity');
    table.enu('yield_unit', YIELD_UNITS);
  });

  if (isPostgres(knex)) {
    await knex.raw('alter table recipe_ingredients alter column product_id drop not null');
    await knex.raw('alter table recipe_ingredients add column sub_recipe_id integer references recipes(id) on delete restrict');
    await knex.raw('create index recipe_ingredients_sub_recipe_id_index on recipe_ingredients (sub_recipe_id)');
    await replacePgCheck(knex, 'recipe_ingredients', 'unit', [...PRODUCT_UNITS, 'portion']);
    await knex.raw(`alter table recipe_ingredients add constraint recipe_ingredients_one_source_check ${ONE_SOURCE_CHECK}`);

    await knex.raw('alter table recipe_cost_history add column sub_recipe_id integer references recipes(id) on delete set null');
    await replacePgCheck(knex, 'recipe_cost_history', 'reason', [...COST_REASONS, 'sub_recipe_changed']);
  } else {
    await rebuildSqlite(knex, 'recipe_ingredients', ingredientsTable(true), INGREDIENT_COLUMNS, INGREDIENT_INDEXES);
    await rebuildSqlite(knex, 'recipe_cost_history', costHistoryTable(true), COST_HISTORY_COLUMNS, COST_HISTORY_INDEXES);
  }
}

export async function down(knex) {
  // Sub-recipe lines and their history links can't exist in the old schema. Food costs of the
  // recipes that used sub-recipes are left as they were (recalculated on their next save).
  await knex('recipe_ingredients').whereNotNull('sub_recipe_id').del();
  await knex('recipe_cost_history').where('reason', 'sub_recipe_changed').update({ reason: 'recipe_updated' });

  if (isPostgres(knex)) {
    await knex.raw('alter table recipe_ingredients drop constraint recipe_ingredients_one_source_check');
    await knex.raw('alter table recipe_ingredients drop column sub_recipe_id');
    await replacePgCheck(knex, 'recipe_ingredients', 'unit', PRODUCT_UNITS);
    await knex.raw('alter table recipe_ingredients alter column product_id set not null');

    await knex.raw('alter table recipe_cost_history drop column sub_recipe_id');
    await replacePgCheck(knex, 'recipe_cost_history', 'reason', COST_REASONS);
  } else {
    await rebuildSqlite(knex, 'recipe_ingredients', ingredientsTable(false), INGREDIENT_COLUMNS, INGREDIENT_INDEXES.slice(0, 2));
    await rebuildSqlite(knex, 'recipe_cost_history', costHistoryTable(false), COST_HISTORY_COLUMNS, COST_HISTORY_INDEXES.slice(0, 2));
  }

  // Native DROP COLUMN; Knex's dropColumn would rebuild `recipes` and cascade-delete its children.
  await knex.raw('alter table recipes drop column yield_unit');
  await knex.raw('alter table recipes drop column yield_quantity');
}

const ONE_SOURCE_CHECK = 'check ((product_id is null) <> (sub_recipe_id is null))';

function isPostgres(knex) {
  return knex.client.dialect === 'postgresql';
}

function inList(values) {
  return values.map((value) => `'${value}'`).join(', ');
}

// Replaces the CHECK constraint that limits `column` to a list of values.
async function replacePgCheck(knex, table, column, values) {
  const constraints = await knex('pg_constraint')
    .where('conrelid', knex.raw('?::regclass', [table]))
    .andWhere('contype', 'c')
    .andWhereRaw('pg_get_constraintdef(oid) like ?', [`%(${column} = ANY%`])
    .pluck('conname');
  for (const name of constraints) await knex.raw('alter table ?? drop constraint ??', [table, name]);
  await knex.raw(`alter table ?? add constraint ?? check (?? in (${inList(values)}))`, [table, `${table}_${column}_check`, column]);
}

// ---------- SQLite table definitions (withSubRecipes = after this migration) ----------

// Columns copied during a rebuild: the ones both versions of the table have.
const INGREDIENT_COLUMNS = ['id', 'recipe_id', 'product_id', 'position', 'quantity', 'unit', 'unit_price', 'cost'];
const INGREDIENT_INDEXES = [
  ['recipe_ingredients_recipe_id_index', 'recipe_id'],
  ['recipe_ingredients_product_id_index', 'product_id'],
  ['recipe_ingredients_sub_recipe_id_index', 'sub_recipe_id'],
];

function ingredientsTable(withSubRecipes) {
  return (name) => `create table \`${name}\` (
    \`id\` integer not null primary key autoincrement,
    \`recipe_id\` integer not null,
    \`product_id\` integer${withSubRecipes ? '' : ' not null'},
    ${withSubRecipes ? '`sub_recipe_id` integer,' : ''}
    \`position\` integer not null,
    \`quantity\` float not null,
    \`unit\` text check (\`unit\` in (${inList(withSubRecipes ? [...PRODUCT_UNITS, 'portion'] : PRODUCT_UNITS)})) not null,
    \`unit_price\` float not null default '0',
    \`cost\` float not null default '0',
    foreign key(\`recipe_id\`) references \`recipes\`(\`id\`) on delete CASCADE,
    foreign key(\`product_id\`) references \`products\`(\`id\`) on delete RESTRICT
    ${withSubRecipes ? `, foreign key(\`sub_recipe_id\`) references \`recipes\`(\`id\`) on delete RESTRICT, ${ONE_SOURCE_CHECK}` : ''}
  )`;
}

const COST_HISTORY_COLUMNS = ['id', 'recipe_id', 'reason', 'product_price_change_id', 'portions', 'food_cost', 'previous_portions', 'previous_food_cost', 'changed_at'];
const COST_HISTORY_INDEXES = [
  ['recipe_cost_history_recipe_id_index', 'recipe_id'],
  ['recipe_cost_history_product_price_change_id_index', 'product_price_change_id'],
  ['recipe_cost_history_sub_recipe_id_index', 'sub_recipe_id'],
];

function costHistoryTable(withSubRecipes) {
  return (name) => `create table \`${name}\` (
    \`id\` integer not null primary key autoincrement,
    \`recipe_id\` integer not null,
    \`reason\` text check (\`reason\` in (${inList(withSubRecipes ? [...COST_REASONS, 'sub_recipe_changed'] : COST_REASONS)})) not null,
    \`product_price_change_id\` integer,
    ${withSubRecipes ? '`sub_recipe_id` integer,' : ''}
    \`portions\` integer not null,
    \`food_cost\` float not null,
    \`previous_portions\` integer,
    \`previous_food_cost\` float,
    \`changed_at\` datetime not null default CURRENT_TIMESTAMP,
    foreign key(\`recipe_id\`) references \`recipes\`(\`id\`) on delete CASCADE,
    foreign key(\`product_price_change_id\`) references \`product_price_history\`(\`id\`) on delete SET NULL
    ${withSubRecipes ? ', foreign key(`sub_recipe_id`) references `recipes`(`id`) on delete SET NULL' : ''}
  )`;
}

// Create the new table, copy the rows, drop the old one, rename the new one, recreate indexes.
async function rebuildSqlite(knex, table, createTable, columns, indexes) {
  const copy = `${table}_rebuild`;
  const list = columns.map((column) => `\`${column}\``).join(', ');
  await knex.raw(createTable(copy));
  await knex.raw(`insert into \`${copy}\` (${list}) select ${list} from \`${table}\``);
  await knex.raw(`drop table \`${table}\``);
  await knex.raw(`alter table \`${copy}\` rename to \`${table}\``);
  for (const [name, column] of indexes) await knex.raw(`create index \`${name}\` on \`${table}\` (\`${column}\`)`);
}
