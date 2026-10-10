import db from '../../db/knex.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { round2, round2OrNull, round6, toIsoDate } from '../../lib/format.js';
import { areCompatible, compatibleUnits } from '../../lib/units.js';
import { recordChange } from '../history/history.recorder.js';
import { loadRecipeSnapshot, recipeSnapshotFromDeletion } from '../history/snapshots.js';
import { insertProduct } from '../products/products.service.js';
import { recalculateRecipeCosts } from './costing.js';

function toRecipeSummaryDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    portions: row.portions,
    foodCost: round2(row.food_cost),
    costPerPortion: round2(row.food_cost / row.portions),
    sellPrice: round2OrNull(row.sell_price),
    ingredientCount: Number(row.ingredient_count),
    updatedAt: toIsoDate(row.updated_at),
  };
}

function toRecipeDto(recipe, ingredients, steps) {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    portions: recipe.portions,
    foodCost: round2(recipe.food_cost),
    costPerPortion: round2(recipe.food_cost / recipe.portions),
    sellPrice: round2OrNull(recipe.sell_price),
    ingredients: ingredients.map((line) => ({
      id: line.id,
      productId: line.product_id,
      productName: line.product_name,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: round6(line.unit_price),
      cost: round2(line.cost),
    })),
    steps,
    createdAt: toIsoDate(recipe.created_at),
    updatedAt: toIsoDate(recipe.updated_at),
  };
}

// Deleted recipes are treated as missing everywhere except restore and the change log.
async function findRecipeRow(executor, id) {
  const row = await executor('recipes').where({ id }).whereNull('deleted_at').first();
  if (!row) throw new NotFoundError('Recipe', id);
  return row;
}

async function loadRecipe(executor, id) {
  const recipe = await findRecipeRow(executor, id);
  const ingredients = await executor('recipe_ingredients as ri')
    .join('products as p', 'p.id', 'ri.product_id')
    .where('ri.recipe_id', id)
    .orderBy('ri.position')
    .select('ri.id', 'ri.product_id', 'p.name as product_name', 'ri.quantity', 'ri.unit', 'ri.unit_price', 'ri.cost');
  const steps = await executor('recipe_steps').where('recipe_id', id).orderBy('position').pluck('instruction');
  return toRecipeDto(recipe, ingredients, steps);
}

// Creates inline products, checks every line and stores the list. Costs are filled in by recalculateRecipeCosts.
async function replaceIngredients(trx, recipeId, ingredients) {
  await trx('recipe_ingredients').where('recipe_id', recipeId).del();

  const rows = [];
  const issues = [];
  for (const [index, ingredient] of ingredients.entries()) {
    const product = ingredient.product
      ? await insertProduct(trx, ingredient.product)
      : await trx('products').where('id', ingredient.productId).first();

    if (!product) {
      issues.push({
        path: `body.ingredients[${index}].productId`,
        message: `Product ${ingredient.productId} does not exist`,
      });
    } else if (!areCompatible(ingredient.unit, product.package_unit)) {
      issues.push({
        path: `body.ingredients[${index}].unit`,
        message: `"${product.name}" is measured in ${product.package_unit}, so the unit must be one of: ${compatibleUnits(product.package_unit).join(', ')}`,
      });
    } else {
      rows.push({
        recipe_id: recipeId,
        product_id: product.id,
        position: index,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      });
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);
  if (rows.length > 0) await trx('recipe_ingredients').insert(rows);
}

async function replaceSteps(trx, recipeId, steps) {
  await trx('recipe_steps').where('recipe_id', recipeId).del();
  if (steps.length > 0) {
    await trx('recipe_steps').insert(
      steps.map((instruction, position) => ({ recipe_id: recipeId, position, instruction })),
    );
  }
}

export async function listRecipes({ search } = {}) {
  const ingredientCount = db('recipe_ingredients as ri')
    .count('*')
    .where('ri.recipe_id', db.ref('r.id'))
    .as('ingredient_count');
  const query = db('recipes as r').whereNull('r.deleted_at').select('r.*', ingredientCount).orderBy('r.name');
  if (search) query.whereRaw('lower(r.name) like ?', [`%${search.toLowerCase()}%`]);
  const rows = await query;
  return rows.map(toRecipeSummaryDto);
}

export async function getRecipe(id) {
  return loadRecipe(db, id);
}

export async function createRecipe(data) {
  return db.transaction(async (trx) => {
    const [{ id }] = await trx('recipes')
      .insert({
        name: data.name,
        description: data.description ?? null,
        portions: data.portions,
        sell_price: data.sellPrice ?? null,
      })
      .returning('id');
    await replaceIngredients(trx, id, data.ingredients);
    await replaceSteps(trx, id, data.steps);
    await recalculateRecipeCosts(trx, [id], { reason: 'created' });
    const after = await loadRecipeSnapshot(trx, id);
    await recordChange(trx, { entityType: 'recipe', entityId: id, entityName: after.name, before: null, after });
    return loadRecipe(trx, id);
  });
}

export async function updateRecipe(id, data, { partial = false } = {}) {
  return db.transaction(async (trx) => {
    await findRecipeRow(trx, id);
    const before = await loadRecipeSnapshot(trx, id);

    const fields = {};
    if (!partial || data.name !== undefined) fields.name = data.name;
    if (!partial || data.description !== undefined) fields.description = data.description ?? null;
    if (!partial || data.portions !== undefined) fields.portions = data.portions;
    if (!partial || data.sellPrice !== undefined) fields.sell_price = data.sellPrice ?? null;
    await trx('recipes').where({ id }).update({ ...fields, updated_at: trx.fn.now() });

    if (!partial || data.ingredients !== undefined) await replaceIngredients(trx, id, data.ingredients);
    if (!partial || data.steps !== undefined) await replaceSteps(trx, id, data.steps);

    await recalculateRecipeCosts(trx, [id], { reason: 'recipe_updated' });
    const after = await loadRecipeSnapshot(trx, id);
    await recordChange(trx, { entityType: 'recipe', entityId: id, entityName: after.name, before, after });
    return loadRecipe(trx, id);
  });
}

// Soft delete: ingredient lines, steps and cost history stay, so the recipe can be restored.
export async function deleteRecipe(id) {
  await db.transaction(async (trx) => {
    await findRecipeRow(trx, id);
    const before = await loadRecipeSnapshot(trx, id);
    await trx('recipes').where({ id }).update({ deleted_at: trx.fn.now() });
    await recordChange(trx, { entityType: 'recipe', entityId: id, entityName: before.name, before, after: null });
  });
}

/**
 * Restores a soft-deleted recipe and recalculates it with current product prices. Ingredient
 * lines that can no longer be used are left out and reported in droppedIngredients:
 * - 'product_deleted': the product was deleted meanwhile (deleteProduct removed the line then).
 * - 'unit_incompatible': the product's unit changed to another kind (e.g. g -> piece) meanwhile.
 */
export async function restoreRecipe(id) {
  return db.transaction(async (trx) => {
    const recipe = await trx('recipes').where({ id }).first();
    if (!recipe) throw new NotFoundError('Recipe', id);
    if (recipe.deleted_at == null) {
      throw new ConflictError('RECIPE_NOT_DELETED', `Recipe "${recipe.name}" is not deleted`);
    }

    // The recipe as it was when deleted, from the change log.
    const deletion = await trx('change_log')
      .where({ entity_type: 'recipe', entity_id: id, action: 'deleted' })
      .orderBy('id', 'desc')
      .first('changes');
    const before = deletion ? recipeSnapshotFromDeletion(JSON.parse(deletion.changes)) : await loadRecipeSnapshot(trx, id);

    const existingProductIds = new Set(
      await trx('products').whereIn('id', before.ingredients.map((line) => line.productId)).pluck('id'),
    );
    const dropped = before.ingredients
      .filter((line) => !existingProductIds.has(line.productId))
      .map((line) => ({ ...line, reason: 'product_deleted' }));

    const lines = await trx('recipe_ingredients as ri')
      .join('products as p', 'p.id', 'ri.product_id')
      .where('ri.recipe_id', id)
      .orderBy('ri.position')
      .select('ri.id', 'ri.product_id', 'p.name as product_name', 'ri.quantity', 'ri.unit', 'p.package_unit');
    const incompatible = lines.filter((line) => !areCompatible(line.unit, line.package_unit));
    if (incompatible.length > 0) {
      await trx('recipe_ingredients').whereIn('id', incompatible.map((line) => line.id)).del();
      dropped.push(
        ...incompatible.map((line) => ({
          productId: line.product_id,
          productName: line.product_name,
          quantity: line.quantity,
          unit: line.unit,
          reason: 'unit_incompatible',
        })),
      );
    }

    await trx('recipes').where({ id }).update({ deleted_at: null, updated_at: trx.fn.now() });
    await recalculateRecipeCosts(trx, [id], { reason: 'recipe_restored' });
    const after = await loadRecipeSnapshot(trx, id);
    await recordChange(trx, { entityType: 'recipe', entityId: id, entityName: after.name, before, after, action: 'restored' });

    return { recipe: await loadRecipe(trx, id), droppedIngredients: dropped };
  });
}
