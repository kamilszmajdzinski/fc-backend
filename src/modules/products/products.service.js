import db from '../../db/knex.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { round2 } from '../../lib/format.js';
import { compatibleUnits } from '../../lib/units.js';
import { suggestCatalogDetails } from '../catalog/catalog.details.js';
import { fold, tokens } from '../catalog/catalog.suggest.js';
import { canonicalCategory } from '../categories/categories.service.js';
import { recordChange, recordProductPriceChange } from '../history/history.recorder.js';
import { productSnapshot } from '../history/snapshots.js';
import { recalculateRecipeCosts } from '../recipes/costing.js';
import { fromProductRow, toProductDto, toProductRow } from './products.mapper.js';

// Another user's product is reported as missing, the same as one that doesn't exist.
async function findProductRow(executor, userId, id) {
  const row = await executor('products').where({ id, user_id: userId }).first();
  if (!row) throw new NotFoundError('Product', id);
  return row;
}

// Deleted recipes don't count as using a product.
function recipesUsingProduct(executor, productId) {
  return executor('recipes as r')
    .join('recipe_ingredients as ri', 'ri.recipe_id', 'r.id')
    .where('ri.product_id', productId)
    .whereNull('r.deleted_at')
    .distinct('r.id', 'r.name')
    .orderBy('r.name');
}

// PATCH with only pricePerUnit must override the stored pricePerPackage (which normally wins).
function applyPatch(current, patch) {
  const merged = { ...current, ...patch };
  if (patch.pricePerUnit !== undefined && patch.pricePerPackage === undefined) {
    merged.pricePerPackage = undefined;
  }
  return merged;
}

// How many (non-deleted) recipes use each product, for the "popularity" sort on the product list.
function withUsageCounts(query) {
  return query
    .leftJoin(
      db('recipe_ingredients as ri')
        .join('recipes as r', 'r.id', 'ri.recipe_id')
        .whereNull('r.deleted_at')
        .countDistinct('r.id', { as: 'count' })
        .select('ri.product_id')
        .groupBy('ri.product_id')
        .as('usage'),
      'usage.product_id',
      'products.id',
    )
    .select('products.*', db.raw('coalesce(usage.count, 0) as usage_count'));
}

export async function listProducts(userId, { search, category } = {}) {
  const query = withUsageCounts(db('products').where('products.user_id', userId)).orderBy('products.name');
  if (category) query.where('products.category', await canonicalCategory(db, userId, 'product', category));
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    query.where((builder) =>
      builder.whereRaw('lower(products.name) like ?', [pattern]).orWhereRaw('lower(products.manufacturer) like ?', [pattern]),
    );
  }
  const rows = await query;
  return rows.map(toProductDto);
}

export async function getProduct(userId, id) {
  const row = await findProductRow(db, userId, id);
  const usageCount = (await recipesUsingProduct(db, id)).length;
  return toProductDto({ ...row, usage_count: usageCount });
}

export async function listRecipesUsingProduct(userId, id) {
  await findProductRow(db, userId, id);
  return recipesUsingProduct(db, id);
}

// Also used when a recipe creates a product inline, so it takes the caller's transaction.
export async function insertProduct(trx, userId, data) {
  const category = await canonicalCategory(trx, userId, 'product', data.category);
  const [row] = await trx('products').insert({ ...toProductRow(data), category, user_id: userId }).returning('*');
  await recordProductPriceChange(trx, { product: row, reason: 'created' });
  await recordChange(trx, { userId, entityType: 'product', entityId: row.id, entityName: row.name, before: null, after: productSnapshot(row) });
  return row;
}

export async function createProduct(userId, data) {
  return db.transaction(async (trx) => toProductDto(await insertProduct(trx, userId, data)));
}

/**
 * Replaces (PUT) or patches (PATCH) a product and logs the changed fields. When anything that
 * affects its price changes, the change also goes into the price history and every recipe using
 * the product (directly or through sub-recipes) is recalculated; their food cost changes are
 * logged as caused by this change.
 */
export async function updateProduct(userId, id, data, { partial = false } = {}) {
  return db.transaction(async (trx) => {
    const current = await findProductRow(trx, userId, id);
    const next = toProductRow(partial ? applyPatch(fromProductRow(current), data) : data);
    next.category = await canonicalCategory(trx, userId, 'product', next.category);

    if (next.package_unit !== current.package_unit) {
      const conflicting = await recipesUsingProduct(trx, id).whereNotIn('ri.unit', compatibleUnits(next.package_unit));
      if (conflicting.length > 0) {
        throw new ConflictError(
          'UNIT_CONFLICT',
          `"${current.name}" is used in recipes with units that do not fit "${next.package_unit}". Change those recipes first.`,
          { recipes: conflicting },
        );
      }
    }

    await trx('products').where({ id }).update({ ...next, updated_at: trx.fn.now() });

    const priceChanged =
      next.price_per_package !== current.price_per_package ||
      next.package_size !== current.package_size ||
      next.package_unit !== current.package_unit;

    const updated = await findProductRow(trx, userId, id);
    const changeId = await recordChange(trx, {
      userId,
      entityType: 'product',
      entityId: id,
      entityName: updated.name,
      before: productSnapshot(current),
      after: productSnapshot(updated),
    });

    let recalculated = [];
    if (priceChanged) {
      const priceChangeId = await recordProductPriceChange(trx, { product: updated, previous: current, reason: 'updated' });
      const usages = await trx('recipe_ingredients').where('product_id', id).distinct('recipe_id');
      // Also recalculates recipes that use those recipes as sub-recipes, and logs every food
      // cost change as caused by this product change.
      recalculated = await recalculateRecipeCosts(trx, usages.map((usage) => usage.recipe_id), {
        reason: 'product_price_changed',
        productPriceChangeId: priceChangeId,
        causeChangeId: changeId,
      });
    }

    const usageCount = (await recipesUsingProduct(trx, id)).length;
    return {
      product: toProductDto({ ...updated, usage_count: usageCount }),
      recalculatedRecipes: recalculated.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        previousFoodCost: round2(recipe.previousFoodCost),
        foodCost: round2(recipe.foodCost),
      })),
    };
  });
}

export async function deleteProduct(userId, id) {
  await db.transaction(async (trx) => {
    const product = await findProductRow(trx, userId, id);
    const recipes = await recipesUsingProduct(trx, id);
    if (recipes.length > 0) {
      throw new ConflictError(
        'PRODUCT_IN_USE',
        `"${product.name}" is used in ${recipes.length} recipe(s). Remove it from them first.`,
        { recipes },
      );
    }
    // Only deleted recipes can still have lines with this product. Remove them so the product
    // can go; restoring such a recipe reports them as dropped.
    await trx('recipe_ingredients').where('product_id', id).del();
    await trx('products').where({ id }).del();
    await recordChange(trx, { userId, entityType: 'product', entityId: id, entityName: product.name, before: productSnapshot(product), after: null });
  });
}

const firstWord = (name) => fold(tokens(name)[0] ?? '');

// The most common value of `field` among rows, with its share: { value, confidence }.
function mostCommon(rows, field) {
  const withValue = rows.filter((row) => row[field]);
  if (withValue.length === 0) return null;
  const [value, group] = [...Map.groupBy(withValue, (row) => row[field])].sort((a, b) => b[1].length - a[1].length)[0];
  return { value, confidence: round2(group.length / withValue.length) };
}

/**
 * What the user chose before for a product with a similar name, so it is suggested again:
 * - category: from products with the same name or, failing that, the same first word ("Mąka
 *   orkiszowa" goes where they put "Mąka pszenna");
 * - manufacturer: only from products with the same name, since "Mąka orkiszowa" can come from a
 *   different mill than "Mąka pszenna".
 */
async function suggestFromOwnProducts(userId, name) {
  const rows = await db('products').where('user_id', userId).select('name', 'category', 'manufacturer');
  const same = rows.filter((row) => fold(row.name.trim()) === fold(name));
  const sameFirstWord = rows.filter((row) => firstWord(row.name) === firstWord(name));
  return {
    category: mostCommon(same, 'category') ?? mostCommon(sameFirstWord, 'category'),
    manufacturer: mostCommon(same, 'manufacturer'),
  };
}

const ALTERNATIVES_LIMIT = { category: 3, manufacturer: 4 };

// The user's own choice wins; the catalog's suggestions become its alternatives.
function combine(field, own, catalog) {
  if (!own) return catalog && { ...catalog, source: 'catalog' };
  const alternatives = [catalog?.value, ...(catalog?.alternatives ?? [])].filter((value) => value && value !== own.value);
  return { ...own, source: 'own', alternatives: [...new Set(alternatives)].slice(0, ALTERNATIVES_LIMIT[field]) };
}

/**
 * A category and a manufacturer for a product name, for the product form: from the user's own
 * products with a similar name first, otherwise from the catalog (a built-in category and the
 * most common brand). Each is { value, source, confidence, alternatives } or null. The user can
 * always pick something else.
 */
export async function suggestProductDetails(userId, name) {
  const [own, catalog] = await Promise.all([suggestFromOwnProducts(userId, name), suggestCatalogDetails(name)]);
  return {
    name,
    category: combine('category', own.category, catalog.category),
    manufacturer: combine('manufacturer', own.manufacturer, catalog.manufacturer),
  };
}
