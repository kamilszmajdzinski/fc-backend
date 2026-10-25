// A read-only copy of the Frisco.pl product catalog, shared by all users and replaced by
// `npm run catalog:import`. Ids are Frisco's own (digit strings).
// - catalog_categories.path is Frisco's parentPath: the category's own id first, then its
//   ancestors up to the top level, e.g. "21118,21117,21107,21106".
// - catalog_product_categories links a product to every category it is in AND all their
//   ancestors, so filtering by any category covers its whole subtree.
// - package_size is the whole package in package_unit (a 12 x 0.5 l pack is 6 l), and
//   price_per_unit = price / package_size.
// Row level security is on with no policies, like every other table (see the user ownership migration).
const TABLES = ['catalog_imports', 'catalog_product_categories', 'catalog_products', 'catalog_categories'];

export async function up(knex) {
  await knex.schema.createTable('catalog_categories', (table) => {
    table.string('id', 20).primary();
    table.string('parent_id', 20);
    table.integer('depth').notNullable();
    table.string('name', 200).notNullable();
    table.string('name_en', 200);
    table.text('path').notNullable();
    table.integer('product_count').notNullable().defaultTo(0);
    table.text('url');
    table.index('parent_id');
  });

  await knex.schema.createTable('catalog_products', (table) => {
    table.string('id', 20).primary();
    table.string('ean', 20);
    table.string('name', 300).notNullable();
    table.string('name_en', 300);
    table.string('brand', 200);
    table.string('producer', 200);
    table.string('primary_category_id', 20);
    table.double('package_size');
    table.enu('package_unit', ['kg', 'l', 'piece']);
    table.integer('pack_count').notNullable().defaultTo(1);
    table.double('price');
    table.double('regular_price');
    table.double('promotion_price');
    table.double('discount_percent');
    table.double('price_per_unit');
    table.double('vat');
    table.boolean('is_available').notNullable().defaultTo(false);
    table.integer('stock');
    table.double('rating');
    table.integer('rating_votes');
    table.string('country_of_origin', 10);
    table.text('description');
    table.text('image_url');
    table.text('product_url');
    table.index('ean');
    table.index('price');
    table.index('price_per_unit');
  });

  await knex.schema.createTable('catalog_product_categories', (table) => {
    table.string('product_id', 20).notNullable().references('id').inTable('catalog_products').onDelete('CASCADE');
    table.string('category_id', 20).notNullable();
    table.primary(['product_id', 'category_id']);
    table.index('category_id');
  });

  await knex.schema.createTable('catalog_imports', (table) => {
    table.increments('id');
    table.string('feed_generated_at', 40);
    table.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
    table.integer('category_count').notNullable();
    table.integer('product_count').notNullable();
  });

  if (knex.client.dialect === 'postgresql') {
    for (const table of TABLES) await knex.raw('alter table ?? enable row level security', [table]);
  }
}

export async function down(knex) {
  for (const table of TABLES) await knex.schema.dropTable(table);
}
