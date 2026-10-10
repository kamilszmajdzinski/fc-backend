// Units are listed here on purpose (not imported) so this migration never changes after it has run.
const UNITS = ['mg', 'g', 'kg', 'ml', 'l', 'piece'];

export async function up(knex) {
  await knex.schema.createTable('products', (table) => {
    table.increments('id');
    table.string('name', 200).notNullable();
    table.text('description');
    table.string('manufacturer', 200);
    table.double('package_size').notNullable();
    table.enu('package_unit', UNITS).notNullable();
    table.double('price_per_package').notNullable();
    table.double('price_per_unit').notNullable();
    table.double('inventory_quantity').notNullable().defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('recipes', (table) => {
    table.increments('id');
    table.string('name', 200).notNullable();
    table.text('description');
    table.integer('portions').notNullable();
    table.double('food_cost').notNullable().defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('recipe_ingredients', (table) => {
    table.increments('id');
    table.integer('recipe_id').notNullable().references('id').inTable('recipes').onDelete('CASCADE');
    table.integer('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    table.integer('position').notNullable();
    table.double('quantity').notNullable();
    table.enu('unit', UNITS).notNullable();
    table.double('unit_price').notNullable().defaultTo(0);
    table.double('cost').notNullable().defaultTo(0);
    table.index('recipe_id');
    table.index('product_id');
  });

  await knex.schema.createTable('recipe_steps', (table) => {
    table.increments('id');
    table.integer('recipe_id').notNullable().references('id').inTable('recipes').onDelete('CASCADE');
    table.integer('position').notNullable();
    table.text('instruction').notNullable();
    table.index('recipe_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTable('recipe_steps');
  await knex.schema.dropTable('recipe_ingredients');
  await knex.schema.dropTable('recipes');
  await knex.schema.dropTable('products');
}
