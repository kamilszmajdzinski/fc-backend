// Each catalog product's built-in kitchen category (catalog.kitchen.js), or null for products that
// aren't kitchen products (cosmetics, cleaning, ready meals, ...). The catalog import sets it; this
// migration fills it in for a catalog imported before.
import { kitchenCategory } from '../../modules/catalog/catalog.kitchen.js';

const CHUNK_SIZE = 500;

export async function up(knex) {
  await knex.schema.alterTable('catalog_products', (table) => {
    table.string('kitchen_category', 100);
    table.index('kitchen_category');
  });

  const links = await knex('catalog_product_categories as pc')
    .join('catalog_categories as c', 'c.id', 'pc.category_id')
    .select('pc.product_id', 'c.name', 'c.depth');
  const byCategory = new Map();
  for (const [productId, productLinks] of Map.groupBy(links, (link) => link.product_id)) {
    const category = kitchenCategory(productLinks);
    if (category) byCategory.set(category, [...(byCategory.get(category) ?? []), productId]);
  }
  for (const [category, ids] of byCategory) {
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      await knex('catalog_products').whereIn('id', ids.slice(i, i + CHUNK_SIZE)).update({ kitchen_category: category });
    }
  }
}

export async function down(knex) {
  await knex.schema.alterTable('catalog_products', (table) => {
    table.dropIndex('kitchen_category');
  });
  // Native DROP COLUMN, as in the other migrations.
  await knex.raw('alter table catalog_products drop column kitchen_category');
}
