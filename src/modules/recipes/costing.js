import { convert, pricingUnitFor } from '../../lib/units.js';
import { recordRecipeCost } from '../history/history.recorder.js';

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

/**
 * Recalculates every ingredient line and the food cost of the given recipes from current
 * product prices, and adds a cost history entry for each recipe whose cost or portions changed.
 * `reason` is 'created', 'recipe_updated', 'recipe_restored' or 'product_price_changed' (then pass
 * productPriceChangeId). Deleted recipes are skipped. Must run inside the caller's transaction.
 * Returns [{ id, name, previousFoodCost, foodCost }].
 */
export async function recalculateRecipeCosts(trx, recipeIds, { reason, productPriceChangeId = null }) {
  if (recipeIds.length === 0) return [];

  const recipes = await trx('recipes')
    .whereIn('id', [...new Set(recipeIds)])
    .whereNull('deleted_at')
    .orderBy('name')
    .select('id', 'name', 'portions', 'food_cost');
  if (recipes.length === 0) return [];
  const ids = recipes.map((recipe) => recipe.id);

  const lines = await trx('recipe_ingredients as ri')
    .join('products as p', 'p.id', 'ri.product_id')
    .whereIn('ri.recipe_id', ids)
    .orderBy(['ri.recipe_id', 'ri.position'])
    .select('ri.id', 'ri.recipe_id', 'ri.quantity', 'ri.unit', 'p.package_size', 'p.package_unit', 'p.price_per_package');

  const foodCosts = new Map(recipes.map((recipe) => [recipe.id, 0]));
  for (const line of lines) {
    const unitPrice = ingredientUnitPrice(
      { pricePerPackage: line.price_per_package, packageSize: line.package_size, packageUnit: line.package_unit },
      line.unit,
    );
    const cost = line.quantity * unitPrice;
    await trx('recipe_ingredients').where('id', line.id).update({ unit_price: unitPrice, cost });
    foodCosts.set(line.recipe_id, foodCosts.get(line.recipe_id) + cost);
  }

  const results = [];
  for (const recipe of recipes) {
    const foodCost = foodCosts.get(recipe.id);
    await trx('recipes').where('id', recipe.id).update({ food_cost: foodCost, updated_at: trx.fn.now() });
    await recordRecipeCost(trx, { recipeId: recipe.id, portions: recipe.portions, foodCost, reason, productPriceChangeId });
    results.push({ id: recipe.id, name: recipe.name, previousFoodCost: recipe.food_cost, foodCost });
  }
  return results;
}
