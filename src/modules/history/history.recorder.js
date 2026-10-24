// Writes history entries. Always runs inside the caller's transaction, so a change and its
// history are saved together or not at all.
import { diffSnapshots } from './snapshots.js';

const SAME_COST_TOLERANCE = 1e-9;

/**
 * Adds a change log entry, owned by `userId`, from the snapshots before and after a save (see snapshots.js).
 * `before` is null when created, `after` is null when deleted; pass `action` for anything else
 * (e.g. 'restored'). An update that changed nothing is not logged. Returns the entry id, or
 * null when nothing was logged.
 */
export async function recordChange(trx, { userId, entityType, entityId, entityName, before, after, action, causeChangeId = null }) {
  action ??= before == null ? 'created' : after == null ? 'deleted' : 'updated';
  const changes = diffSnapshots(before, after);
  if (action === 'updated' && changes.length === 0) return null;

  const [{ id }] = await trx('change_log')
    .insert({
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      action,
      changes: JSON.stringify(changes),
      cause_change_id: causeChangeId,
    })
    .returning('id');
  return id;
}

/**
 * Stores a product's price after it was created or changed. `previous` is the product row
 * before the change, or null for a new product. Returns the history entry id.
 */
export async function recordProductPriceChange(trx, { product, previous = null, reason }) {
  const [{ id }] = await trx('product_price_history')
    .insert({
      product_id: product.id,
      product_name: product.name,
      reason,
      package_size: product.package_size,
      package_unit: product.package_unit,
      price_per_package: product.price_per_package,
      price_per_unit: product.price_per_unit,
      previous_package_size: previous?.package_size ?? null,
      previous_package_unit: previous?.package_unit ?? null,
      previous_price_per_package: previous?.price_per_package ?? null,
      previous_price_per_unit: previous?.price_per_unit ?? null,
    })
    .returning('id');
  return id;
}

/**
 * Stores a recipe's food cost, but only when it or the portions differ from the last entry.
 * `productPriceChangeId` links the entry to the product price change that caused it, and
 * `subRecipeId` to the sub-recipe whose change reached this recipe.
 */
export async function recordRecipeCost(trx, { recipeId, portions, foodCost, reason, productPriceChangeId = null, subRecipeId = null }) {
  const last = await trx('recipe_cost_history')
    .where('recipe_id', recipeId)
    .orderBy('id', 'desc')
    .first('portions', 'food_cost');

  if (last && last.portions === portions && Math.abs(last.food_cost - foodCost) < SAME_COST_TOLERANCE) return;

  await trx('recipe_cost_history').insert({
    recipe_id: recipeId,
    reason,
    product_price_change_id: productPriceChangeId,
    sub_recipe_id: subRecipeId,
    portions,
    food_cost: foodCost,
    previous_portions: last?.portions ?? null,
    previous_food_cost: last?.food_cost ?? null,
  });
}
