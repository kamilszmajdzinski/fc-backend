import db from '../../db/knex.js';
import { PRODUCT_CATEGORIES, RECIPE_CATEGORIES } from './categories.defaults.js';

const SOURCES = {
  product: { table: 'products', defaults: PRODUCT_CATEGORIES, active: (query) => query },
  // Deleted recipes keep their category but don't count towards it.
  recipe: { table: 'recipes', defaults: RECIPE_CATEGORIES, active: (query) => query.whereNull('deleted_at') },
};

const sameName = (a, b) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;

async function usedCategories(executor, userId, type) {
  const { table, active } = SOURCES[type];
  const rows = await active(executor(table).where('user_id', userId).whereNotNull('category'))
    .groupBy('category')
    .select('category', executor.raw('count(*) as count'));
  return rows.map((row) => ({ name: row.category, count: Number(row.count) }));
}

/**
 * The built-in categories plus every category the user has used, with how many of their products
 * (or recipes) are in each. A used category spelled like a built-in one apart from letter case
 * counts as that built-in one.
 */
export async function listCategories(userId, type) {
  const items = SOURCES[type].defaults.map((name) => ({ name, count: 0, isDefault: true }));
  for (const { name, count } of await usedCategories(db, userId, type)) {
    const existing = items.find((item) => sameName(item.name, name));
    if (existing) existing.count += count;
    else items.push({ name, count, isDefault: false });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

/**
 * The spelling to store for a category the user sent: an existing category (built-in or their
 * own) that differs only in letter case wins, so "nabiał" joins "Nabiał" instead of starting a
 * second category. Blank means no category.
 */
export async function canonicalCategory(executor, userId, type, category) {
  if (!category) return null;
  const builtIn = SOURCES[type].defaults.find((name) => sameName(name, category));
  if (builtIn) return builtIn;
  const own = (await usedCategories(executor, userId, type)).find((item) => sameName(item.name, category));
  return own?.name ?? category;
}
