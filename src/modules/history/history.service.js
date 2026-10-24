import db from '../../db/knex.js';
import { NotFoundError } from '../../lib/errors.js';
import { round2, round2OrNull, toIsoDate } from '../../lib/format.js';
import { pricingUnitFor } from '../../lib/units.js';

// Price fields of a history row; prefix 'previous_' reads the values before the change.
function priceSnapshot(row, prefix = '') {
  const unit = row[`${prefix}package_unit`];
  if (unit == null) return null;
  return {
    packageSize: row[`${prefix}package_size`],
    packageUnit: unit,
    pricePerPackage: round2(row[`${prefix}price_per_package`]),
    pricePerUnit: round2(row[`${prefix}price_per_unit`]),
    pricingUnit: pricingUnitFor(unit),
  };
}

function costSnapshot(portions, foodCost) {
  return { portions, foodCost: round2(foodCost), costPerPortion: round2(foodCost / portions) };
}

// Another user's product or recipe is reported as missing, the same as one that doesn't exist.
async function ensureExists(table, resource, userId, id, { activeOnly = false } = {}) {
  const query = db(table).where({ id, user_id: userId });
  if (activeOnly) query.whereNull('deleted_at');
  const row = await query.first('id');
  if (!row) throw new NotFoundError(resource, id);
}

const ENTITIES = {
  product: { table: 'products', resource: 'Product' },
  recipe: { table: 'recipes', resource: 'Recipe' },
};

function toChangeDto(row) {
  return {
    id: row.id,
    changedAt: toIsoDate(row.changed_at),
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    action: row.action,
    changes: JSON.parse(row.changes),
  };
}

// Adds the change that caused each entry (triggeredBy) and the changes each entry caused (triggered).
async function withLinks(userId, rows) {
  const causeIds = [...new Set(rows.map((row) => row.cause_change_id).filter((id) => id != null))];
  const causes = causeIds.length === 0 ? [] : await db('change_log').where('user_id', userId).whereIn('id', causeIds);
  const triggered =
    rows.length === 0
      ? []
      : await db('change_log').where('user_id', userId).whereIn('cause_change_id', rows.map((row) => row.id)).orderBy('id');
  const causeById = new Map(causes.map((cause) => [cause.id, cause]));

  return rows.map((row) => {
    const cause = causeById.get(row.cause_change_id);
    return {
      ...toChangeDto(row),
      triggeredBy: cause ? toChangeDto(cause) : null,
      triggered: triggered.filter((entry) => entry.cause_change_id === row.id).map(toChangeDto),
    };
  });
}

// Newest first. Works for deleted products and recipes too, as long as they have entries.
export async function getEntityChanges(userId, entityType, entityId) {
  const rows = await db('change_log')
    .where({ user_id: userId, entity_type: entityType, entity_id: entityId })
    .orderBy('id', 'desc');
  if (rows.length === 0) {
    const { table, resource } = ENTITIES[entityType];
    await ensureExists(table, resource, userId, entityId);
  }
  return withLinks(userId, rows);
}

// Newest first across all products and recipes. Pass the returned nextBefore as `before` for the next page.
export async function getChangeFeed(userId, { entityType, limit, before }) {
  const query = db('change_log').where('user_id', userId).orderBy('id', 'desc').limit(limit);
  if (entityType) query.where('entity_type', entityType);
  if (before) query.where('id', '<', before);
  const rows = await query;
  return {
    items: await withLinks(userId, rows),
    nextBefore: rows.length === limit ? rows.at(-1).id : null,
  };
}

// Newest first. Each entry lists the recipes whose food cost changed because of it.
export async function getProductPriceHistory(userId, productId) {
  await ensureExists('products', 'Product', userId, productId);

  const rows = await db('product_price_history').where('product_id', productId).orderBy('id', 'desc');
  const affected =
    rows.length === 0
      ? []
      : await db('recipe_cost_history as h')
          .join('recipes as r', 'r.id', 'h.recipe_id')
          .whereIn('h.product_price_change_id', rows.map((row) => row.id))
          .orderBy('r.name')
          .select('h.product_price_change_id', 'r.id', 'r.name', 'h.previous_food_cost', 'h.food_cost');

  return rows.map((row) => ({
    id: row.id,
    changedAt: toIsoDate(row.changed_at),
    reason: row.reason,
    ...priceSnapshot(row),
    previous: priceSnapshot(row, 'previous_'),
    affectedRecipes: affected
      .filter((recipe) => recipe.product_price_change_id === row.id)
      .map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        previousFoodCost: round2OrNull(recipe.previous_food_cost),
        foodCost: round2(recipe.food_cost),
      })),
  }));
}

// Newest first. Entries caused by a product price change name the product and its price change;
// entries that reached this recipe through a sub-recipe name that sub-recipe.
// Hidden (404) while the recipe is deleted, like the recipe itself; it comes back on restore.
export async function getRecipeCostHistory(userId, recipeId) {
  await ensureExists('recipes', 'Recipe', userId, recipeId, { activeOnly: true });

  const rows = await db('recipe_cost_history as h')
    .leftJoin('product_price_history as c', 'c.id', 'h.product_price_change_id')
    .leftJoin('products as p', 'p.id', 'c.product_id')
    .leftJoin('recipes as s', 's.id', 'h.sub_recipe_id')
    .where('h.recipe_id', recipeId)
    .orderBy('h.id', 'desc')
    .select(
      'h.*',
      's.name as sub_recipe_name',
      'c.product_id as cause_product_id',
      'c.product_name as cause_product_name_then',
      'p.name as cause_product_name_now',
      'c.price_per_package as cause_price_per_package',
      'c.previous_price_per_package as cause_previous_price_per_package',
      'c.price_per_unit as cause_price_per_unit',
      'c.previous_price_per_unit as cause_previous_price_per_unit',
      'c.package_unit as cause_package_unit',
    );

  return rows.map((row) => ({
    id: row.id,
    changedAt: toIsoDate(row.changed_at),
    reason: row.reason,
    ...costSnapshot(row.portions, row.food_cost),
    previous: row.previous_food_cost == null ? null : costSnapshot(row.previous_portions, row.previous_food_cost),
    cause:
      row.product_price_change_id == null
        ? null
        : {
            priceChangeId: row.product_price_change_id,
            productId: row.cause_product_id,
            // Current name if the product still exists, otherwise the name it had at the time.
            productName: row.cause_product_name_now ?? row.cause_product_name_then,
            previousPricePerPackage: round2OrNull(row.cause_previous_price_per_package),
            pricePerPackage: round2(row.cause_price_per_package),
            previousPricePerUnit: round2OrNull(row.cause_previous_price_per_unit),
            pricePerUnit: round2(row.cause_price_per_unit),
            pricingUnit: pricingUnitFor(row.cause_package_unit),
          },
    subRecipe: row.sub_recipe_id == null ? null : { id: row.sub_recipe_id, name: row.sub_recipe_name },
  }));
}
