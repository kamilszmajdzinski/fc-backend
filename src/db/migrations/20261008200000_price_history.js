// Price history for products and food cost history for recipes.
// Each row is one change event that stores the new values and the values before the change.
const UNITS = ['mg', 'g', 'kg', 'ml', 'l', 'piece'];

export async function up(knex) {
  await knex.schema.createTable('product_price_history', (table) => {
    table.increments('id');
    // Kept (as NULL) when the product is deleted, so recipe history can still name the cause.
    table.integer('product_id').references('id').inTable('products').onDelete('SET NULL');
    table.string('product_name', 200).notNullable();
    table.enu('reason', ['created', 'updated']).notNullable();
    table.double('package_size').notNullable();
    table.enu('package_unit', UNITS).notNullable();
    table.double('price_per_package').notNullable();
    table.double('price_per_unit').notNullable();
    table.double('previous_package_size');
    table.enu('previous_package_unit', UNITS);
    table.double('previous_price_per_package');
    table.double('previous_price_per_unit');
    table.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    table.index('product_id');
  });

  await knex.schema.createTable('recipe_cost_history', (table) => {
    table.increments('id');
    table.integer('recipe_id').notNullable().references('id').inTable('recipes').onDelete('CASCADE');
    table.enu('reason', ['created', 'recipe_updated', 'product_price_changed']).notNullable();
    table.integer('product_price_change_id').references('id').inTable('product_price_history').onDelete('SET NULL');
    table.integer('portions').notNullable();
    table.double('food_cost').notNullable();
    table.integer('previous_portions');
    table.double('previous_food_cost');
    table.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    table.index('recipe_id');
    table.index('product_price_change_id');
  });

  // Starting point for data that existed before history was tracked: the current values,
  // dated when they were last changed.
  const products = await knex('products').select('id', 'name', 'package_size', 'package_unit', 'price_per_package', 'price_per_unit', 'updated_at');
  for (const chunk of chunks(products, 200)) {
    await knex('product_price_history').insert(
      chunk.map((product) => ({
        product_id: product.id,
        product_name: product.name,
        reason: 'created',
        package_size: product.package_size,
        package_unit: product.package_unit,
        price_per_package: product.price_per_package,
        price_per_unit: product.price_per_unit,
        changed_at: product.updated_at,
      })),
    );
  }

  const recipes = await knex('recipes').select('id', 'portions', 'food_cost', 'updated_at');
  for (const chunk of chunks(recipes, 200)) {
    await knex('recipe_cost_history').insert(
      chunk.map((recipe) => ({
        recipe_id: recipe.id,
        reason: 'created',
        portions: recipe.portions,
        food_cost: recipe.food_cost,
        changed_at: recipe.updated_at,
      })),
    );
  }
}

export async function down(knex) {
  await knex.schema.dropTable('recipe_cost_history');
  await knex.schema.dropTable('product_price_history');
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
