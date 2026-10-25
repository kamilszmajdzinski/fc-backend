// Optional category of a product or recipe: free text, picked from the built-in list
// (src/modules/categories/categories.defaults.js) or made up by the user.
const TABLES = ['products', 'recipes'];

export async function up(knex) {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.string('category', 100);
    });
  }
}

export async function down(knex) {
  // Native DROP COLUMN; Knex's dropColumn would rebuild `recipes` and cascade-delete its children.
  for (const table of TABLES) await knex.raw('alter table ?? drop column category', [table]);
}
