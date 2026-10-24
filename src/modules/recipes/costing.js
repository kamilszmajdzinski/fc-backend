import { round2 } from '../../lib/format.js';
import { convert, pricingUnitFor } from '../../lib/units.js';
import { recordChange, recordRecipeCost } from '../history/history.recorder.js';

const SAME_COST_TOLERANCE = 1e-9;

/**
 * Price per package is the source of truth. The client may send either price and the other
 * is derived. "Price per unit" means per kg, per l or per piece, depending on the package unit.
 */
export function resolvePrices({ packageSize, packageUnit, pricePerPackage, pricePerUnit }) {
  const sizeInPricingUnits = convert(packageSize, packageUnit, pricingUnitFor(packageUnit));
  if (pricePerPackage != null) {
    return { pricePerPackage, pricePerUnit: pricePerPackage / sizeInPricingUnits };
  }
  return { pricePerPackage: pricePerUnit * sizeInPricingUnits, pricePerUnit };
}

// Price of one `unit` (e.g. 1 g) of a product.
export function ingredientUnitPrice(product, unit) {
  return product.pricePerPackage / convert(product.packageSize, product.packageUnit, unit);
}

// Price of one `unit` of a sub-recipe: per portion, or per g/ml/... of its yield.
export function subRecipeUnitPrice(recipe, unit) {
  if (unit === 'portion') return recipe.foodCost / recipe.portions;
  return recipe.foodCost / convert(recipe.yieldQuantity, recipe.yieldUnit, unit);
}

// Active recipes that use any of `ids` as a sub-recipe: [{ parent, child }].
export async function parentLinks(trx, ids) {
  return trx('recipe_ingredients as ri')
    .join('recipes as r', 'r.id', 'ri.recipe_id')
    .whereIn('ri.sub_recipe_id', ids)
    .whereNull('r.deleted_at')
    .distinct('ri.recipe_id as parent', 'ri.sub_recipe_id as child');
}

// The given recipes plus every recipe that uses them (directly or further up), ordered so that
// a sub-recipe always comes before the recipes that use it. Also returns child ids per recipe.
async function withParentsInOrder(trx, ids) {
  const nodes = new Set(ids);
  const childrenOf = new Map();
  let frontier = [...ids];
  while (frontier.length > 0) {
    const links = await parentLinks(trx, frontier);
    frontier = [];
    for (const { parent, child } of links) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, new Set());
      childrenOf.get(parent).add(child);
      if (!nodes.has(parent)) {
        nodes.add(parent);
        frontier.push(parent);
      }
    }
  }

  const waitingFor = new Map([...nodes].map((id) => [id, [...(childrenOf.get(id) ?? [])].filter((child) => nodes.has(child)).length]));
  const order = [];
  const ready = [...nodes].filter((id) => waitingFor.get(id) === 0);
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const [parent, children] of childrenOf) {
      if (!children.has(id)) continue;
      waitingFor.set(parent, waitingFor.get(parent) - 1);
      if (waitingFor.get(parent) === 0) ready.push(parent);
    }
  }
  // Loops are rejected when recipes are saved, so this would mean corrupted data.
  if (order.length !== nodes.size) throw new Error('Recipes use each other in a loop');
  return { order, childrenOf };
}

// Prices every line of one recipe from current product prices and sub-recipe costs.
// Returns the new food cost.
async function recalculateLines(trx, recipeId) {
  const lines = await trx('recipe_ingredients as ri')
    .leftJoin('products as p', 'p.id', 'ri.product_id')
    .leftJoin('recipes as s', 's.id', 'ri.sub_recipe_id')
    .where('ri.recipe_id', recipeId)
    .orderBy('ri.position')
    .select(
      'ri.id',
      'ri.quantity',
      'ri.unit',
      'ri.product_id',
      'p.package_size',
      'p.package_unit',
      'p.price_per_package',
      's.food_cost as sub_food_cost',
      's.portions as sub_portions',
      's.yield_quantity as sub_yield_quantity',
      's.yield_unit as sub_yield_unit',
    );

  let foodCost = 0;
  for (const line of lines) {
    const unitPrice =
      line.product_id != null
        ? ingredientUnitPrice({ pricePerPackage: line.price_per_package, packageSize: line.package_size, packageUnit: line.package_unit }, line.unit)
        : subRecipeUnitPrice(
            { foodCost: line.sub_food_cost, portions: line.sub_portions, yieldQuantity: line.sub_yield_quantity, yieldUnit: line.sub_yield_unit },
            line.unit,
          );
    const cost = line.quantity * unitPrice;
    await trx('recipe_ingredients').where('id', line.id).update({ unit_price: unitPrice, cost });
    foodCost += cost;
  }
  return foodCost;
}

/**
 * Recalculates the given recipes and then every recipe that uses them as a sub-recipe, all the
 * way up, sub-recipes first. Deleted recipes are skipped. Must run inside the caller's transaction.
 *
 * - Cost history: the given recipes get `reason` (with `productPriceChangeId` / `subRecipeId` if
 *   passed). Recipes above them get 'sub_recipe_changed', or 'product_price_changed' when the whole
 *   chain started with a product price change, plus the sub-recipe that passed the change on.
 * - Change log: with `causeChangeId`, every recipe whose food cost changed gets a foodCost entry
 *   linked to the change that caused it (the product change, or the sub-recipe's entry).
 * - `withParents: false` recalculates only the given recipes.
 *
 * Returns [{ id, name, previousFoodCost, foodCost }]: every given recipe, plus each recipe above
 * them whose food cost changed.
 */
export async function recalculateRecipeCosts(
  trx,
  recipeIds,
  { reason, productPriceChangeId = null, subRecipeId = null, causeChangeId = null, withParents = true },
) {
  if (recipeIds.length === 0) return [];
  const start = await trx('recipes').whereIn('id', [...new Set(recipeIds)]).whereNull('deleted_at').pluck('id');
  if (start.length === 0) return [];

  const { order, childrenOf } = withParents ? await withParentsInOrder(trx, start) : { order: start, childrenOf: new Map() };
  const isStart = new Set(start);
  const changed = new Map(); // recipe id -> its change log entry id (or null)
  const results = [];

  for (const id of order) {
    let entry;
    if (isStart.has(id)) {
      entry = { reason, productPriceChangeId, subRecipeId, causeChangeId };
    } else {
      // Above the given recipes, only recipes with a changed sub-recipe can change.
      const changedChild = [...childrenOf.get(id)].find((child) => changed.has(child));
      if (changedChild === undefined) continue;
      entry = {
        reason: productPriceChangeId ? 'product_price_changed' : 'sub_recipe_changed',
        productPriceChangeId,
        subRecipeId: changedChild,
        causeChangeId: changed.get(changedChild) ?? causeChangeId,
      };
    }

    const recipe = await trx('recipes').where({ id }).first('id', 'user_id', 'name', 'portions', 'food_cost');
    const foodCost = await recalculateLines(trx, id);
    const costChanged = Math.abs(foodCost - recipe.food_cost) >= SAME_COST_TOLERANCE;
    await trx('recipes').where({ id }).update({ food_cost: foodCost, updated_at: trx.fn.now() });
    await recordRecipeCost(trx, {
      recipeId: id,
      portions: recipe.portions,
      foodCost,
      reason: entry.reason,
      productPriceChangeId: entry.productPriceChangeId,
      subRecipeId: entry.subRecipeId,
    });

    if (costChanged) {
      const logId =
        entry.causeChangeId == null
          ? null
          : await recordChange(trx, {
              userId: recipe.user_id,
              entityType: 'recipe',
              entityId: id,
              entityName: recipe.name,
              before: { foodCost: round2(recipe.food_cost) },
              after: { foodCost: round2(foodCost) },
              causeChangeId: entry.causeChangeId,
            });
      changed.set(id, logId);
    }
    if (isStart.has(id) || costChanged) {
      results.push({ id, name: recipe.name, previousFoodCost: recipe.food_cost, foodCost });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
