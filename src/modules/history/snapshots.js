// Snapshots are the tracked fields of a product or recipe, with values as the API shows them.
// The change log stores the difference between the snapshot before and after a save.
import { round2, round2OrNull } from '../../lib/format.js';

export function productSnapshot(row) {
  return {
    name: row.name,
    description: row.description,
    manufacturer: row.manufacturer,
    packageSize: row.package_size,
    packageUnit: row.package_unit,
    pricePerPackage: round2(row.price_per_package),
    pricePerUnit: round2(row.price_per_unit),
    inventoryQuantity: row.inventory_quantity,
  };
}

// Returns null if the recipe does not exist. Runs inside the caller's transaction.
export async function loadRecipeSnapshot(trx, recipeId) {
  const recipe = await trx('recipes').where('id', recipeId).first();
  if (!recipe) return null;

  const ingredients = await trx('recipe_ingredients as ri')
    .join('products as p', 'p.id', 'ri.product_id')
    .where('ri.recipe_id', recipeId)
    .orderBy('ri.position')
    .select('ri.product_id', 'p.name as product_name', 'ri.quantity', 'ri.unit');
  const steps = await trx('recipe_steps').where('recipe_id', recipeId).orderBy('position').pluck('instruction');

  return {
    name: recipe.name,
    description: recipe.description,
    portions: recipe.portions,
    sellPrice: round2OrNull(recipe.sell_price),
    ingredients: ingredients.map((line) => ({
      productId: line.product_id,
      productName: line.product_name,
      quantity: line.quantity,
      unit: line.unit,
    })),
    steps,
    foodCost: round2(recipe.food_cost),
  };
}

// Rebuilds a recipe snapshot from the `changes` of its 'deleted' change log entry, where empty
// fields were left out.
export function recipeSnapshotFromDeletion(changes) {
  const snapshot = { name: null, description: null, portions: null, sellPrice: null, ingredients: [], steps: [], foodCost: null };
  for (const { field, from } of changes) snapshot[field] = from;
  return snapshot;
}

// Product names inside a recipe's ingredient list are only there for display: renaming a
// product is logged on the product, not as a change of every recipe that uses it.
const comparable = {
  ingredients: (list) => list?.map(({ productId, quantity, unit }) => [productId, quantity, unit]),
};

function isSame(field, a, b) {
  const key = comparable[field] ?? ((value) => value);
  return JSON.stringify(key(a ?? null)) === JSON.stringify(key(b ?? null));
}

function isEmpty(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Lists the fields that differ as [{ field, from, to }]. `before` is null for a new entity
 * and `after` is null for a deleted one; empty fields are left out in those two cases.
 */
export function diffSnapshots(before, after) {
  const changes = [];
  for (const field of Object.keys(after ?? before)) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (before && after && isSame(field, from, to)) continue;
    if (!before && isEmpty(to)) continue;
    if (!after && isEmpty(from)) continue;
    changes.push({ field, from, to });
  }
  return changes;
}
