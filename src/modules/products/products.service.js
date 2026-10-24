import db from '../../db/knex.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { round2 } from '../../lib/format.js';
import { compatibleUnits } from '../../lib/units.js';
import { recordChange, recordProductPriceChange } from '../history/history.recorder.js';
import { productSnapshot } from '../history/snapshots.js';
import { recalculateRecipeCosts } from '../recipes/costing.js';
import { fromProductRow, toProductDto, toProductRow } from './products.mapper.js';

async function findProductRow(executor, id) {
  const row = await executor('products').where({ id }).first();
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

export async function listProducts({ search } = {}) {
  const query = db('products').orderBy('name');
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    query.where((builder) =>
      builder.whereRaw('lower(name) like ?', [pattern]).orWhereRaw('lower(manufacturer) like ?', [pattern]),
    );
  }
  const rows = await query;
  return rows.map(toProductDto);
}

export async function getProduct(id) {
  return toProductDto(await findProductRow(db, id));
}

export async function listRecipesUsingProduct(id) {
  await findProductRow(db, id);
  return recipesUsingProduct(db, id);
}

// Also used when a recipe creates a product inline, so it takes the caller's transaction.
export async function insertProduct(trx, data) {
  const [row] = await trx('products').insert(toProductRow(data)).returning('*');
  await recordProductPriceChange(trx, { product: row, reason: 'created' });
  await recordChange(trx, { entityType: 'product', entityId: row.id, entityName: row.name, before: null, after: productSnapshot(row) });
  return row;
}

export async function createProduct(data) {
  return db.transaction(async (trx) => toProductDto(await insertProduct(trx, data)));
}

/**
 * Replaces (PUT) or patches (PATCH) a product and logs the changed fields. When anything that
 * affects its price changes, the change also goes into the price history and every recipe using
 * the product (directly or through sub-recipes) is recalculated; their food cost changes are
 * logged as caused by this change.
 */
export async function updateProduct(id, data, { partial = false } = {}) {
  return db.transaction(async (trx) => {
    const current = await findProductRow(trx, id);
    const next = toProductRow(partial ? applyPatch(fromProductRow(current), data) : data);

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

    const updated = await findProductRow(trx, id);
    const changeId = await recordChange(trx, {
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

    return {
      product: toProductDto(updated),
      recalculatedRecipes: recalculated.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        previousFoodCost: round2(recipe.previousFoodCost),
        foodCost: round2(recipe.foodCost),
      })),
    };
  });
}

export async function deleteProduct(id) {
  await db.transaction(async (trx) => {
    const product = await findProductRow(trx, id);
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
    await recordChange(trx, { entityType: 'product', entityId: id, entityName: product.name, before: productSnapshot(product), after: null });
  });
}
