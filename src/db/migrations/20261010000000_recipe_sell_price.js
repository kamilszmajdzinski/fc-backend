// Optional selling price of a whole recipe (the same scope as food_cost).
export async function up(knex) {
  await knex.schema.alterTable('recipes', (table) => {
    table.double('sell_price');
  });
}

export async function down(knex) {
  // Native DROP COLUMN (SQLite 3.35+ and PostgreSQL). Knex's dropColumn rebuilds the table on
  // SQLite, and dropping the old `recipes` table would cascade-delete ingredients, steps and history.
  await knex.raw('alter table recipes drop column sell_price');
}
