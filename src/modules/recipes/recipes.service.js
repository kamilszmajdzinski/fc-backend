import db from '../../db/knex.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { round2, round2OrNull, round6, toIsoDate } from '../../lib/format.js';
import { areCompatible, compatibleUnits, subRecipeUnits } from '../../lib/units.js';
import { canonicalCategory } from '../categories/categories.service.js';
import { recordChange } from '../history/history.recorder.js';
import { loadRecipeSnapshot, recipeSnapshotFromDeletion } from '../history/snapshots.js';
import { insertProduct } from '../products/products.service.js';
import { parentLinks, recalculateRecipeCosts } from './costing.js';

function toRecipeSummaryDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    portions: row.portions,
    foodCost: round2(row.food_cost),
    costPerPortion: round2(row.food_cost / row.portions),
    sellPrice: round2OrNull(row.sell_price),
    yieldQuantity: row.yield_quantity,
    yieldUnit: row.yield_unit,
    ingredientCount: Number(row.ingredient_count),
    updatedAt: toIsoDate(row.updated_at),
  };
}

function toRecipeDto(recipe, ingredients, steps) {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    category: recipe.category,
    portions: recipe.portions,
    foodCost: round2(recipe.food_cost),
    costPerPortion: round2(recipe.food_cost / recipe.portions),
    sellPrice: round2OrNull(recipe.sell_price),
    yieldQuantity: recipe.yield_quantity,
    yieldUnit: recipe.yield_unit,
    ingredients: ingredients.map((line) => {
      const isRecipe = line.sub_recipe_id != null;
      return {
        id: line.id,
        type: isRecipe ? 'recipe' : 'product',
        productId: line.product_id,
        productName: line.product_name,
        recipeId: line.sub_recipe_id,
        recipeName: line.recipe_name,
        name: isRecipe ? line.recipe_name : line.product_name,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: round6(line.unit_price),
        cost: round2(line.cost),
      };
    }),
    steps,
    createdAt: toIsoDate(recipe.created_at),
    updatedAt: toIsoDate(recipe.updated_at),
  };
}

// Deleted recipes are treated as missing everywhere except restore and the change log.
// Another user's recipe is reported as missing, the same as one that doesn't exist.
async function findRecipeRow(executor, userId, id) {
  const row = await executor('recipes').where({ id, user_id: userId }).whereNull('deleted_at').first();
  if (!row) throw new NotFoundError('Recipe', id);
  return row;
}

async function loadRecipe(executor, userId, id) {
  const recipe = await findRecipeRow(executor, userId, id);
  const ingredients = await executor('recipe_ingredients as ri')
    .leftJoin('products as p', 'p.id', 'ri.product_id')
    .leftJoin('recipes as s', 's.id', 'ri.sub_recipe_id')
    .where('ri.recipe_id', id)
    .orderBy('ri.position')
    .select(
      'ri.id',
      'ri.product_id',
      'p.name as product_name',
      'ri.sub_recipe_id',
      's.name as recipe_name',
      'ri.quantity',
      'ri.unit',
      'ri.unit_price',
      'ri.cost',
    );
  const steps = await executor('recipe_steps').where('recipe_id', id).orderBy('position').pluck('instruction');
  return toRecipeDto(recipe, ingredients, steps);
}

// Active recipes that use the recipe as a sub-recipe: [{ id, name }].
function recipesUsingRecipe(executor, recipeId) {
  return executor('recipes as r')
    .join('recipe_ingredients as ri', 'ri.recipe_id', 'r.id')
    .where('ri.sub_recipe_id', recipeId)
    .whereNull('r.deleted_at')
    .distinct('r.id', 'r.name')
    .orderBy('r.name');
}

// Whether `recipeId` uses `targetId`, directly or through its own sub-recipes.
async function usesRecipe(trx, recipeId, targetId) {
  const seen = new Set();
  let frontier = [recipeId];
  while (frontier.length > 0) {
    frontier.forEach((id) => seen.add(id));
    const next = await trx('recipe_ingredients').whereIn('recipe_id', frontier).whereNotNull('sub_recipe_id').distinct().pluck('sub_recipe_id');
    if (next.includes(targetId)) return true;
    frontier = next.filter((id) => !seen.has(id));
  }
  return false;
}

function unitIssue(index, message) {
  return { path: `body.ingredients[${index}].unit`, message };
}

// Checks one sub-recipe line. Returns an issue, or null when the line is fine.
async function checkSubRecipeLine(trx, recipeId, index, ingredient, subRecipe) {
  if (!subRecipe) {
    return { path: `body.ingredients[${index}].recipeId`, message: `Recipe ${ingredient.recipeId} does not exist` };
  }
  if (subRecipe.id === recipeId) {
    return { path: `body.ingredients[${index}].recipeId`, message: 'A recipe cannot use itself' };
  }
  if (await usesRecipe(trx, subRecipe.id, recipeId)) {
    return {
      path: `body.ingredients[${index}].recipeId`,
      message: `"${subRecipe.name}" already uses this recipe, so this recipe cannot use it`,
    };
  }
  if (!subRecipeUnits(subRecipe.yield_unit).includes(ingredient.unit)) {
    return unitIssue(
      index,
      subRecipe.yield_unit
        ? `"${subRecipe.name}" yields ${subRecipe.yield_quantity} ${subRecipe.yield_unit}, so the unit must be one of: ${subRecipeUnits(subRecipe.yield_unit).join(', ')}`
        : `"${subRecipe.name}" has no yield, so it can only be used in portions`,
    );
  }
  return null;
}

// Creates inline products, checks every line and stores the list. Costs are filled in by recalculateRecipeCosts.
// Products and sub-recipes must belong to `userId`; anyone else's are reported as missing.
async function replaceIngredients(trx, userId, recipeId, ingredients) {
  await trx('recipe_ingredients').where('recipe_id', recipeId).del();

  const rows = [];
  const issues = [];
  for (const [index, ingredient] of ingredients.entries()) {
    const line = { recipe_id: recipeId, position: index, quantity: ingredient.quantity, unit: ingredient.unit };

    if (ingredient.recipeId != null) {
      const subRecipe = await trx('recipes').where({ id: ingredient.recipeId, user_id: userId }).whereNull('deleted_at').first();
      const issue = await checkSubRecipeLine(trx, recipeId, index, ingredient, subRecipe);
      if (issue) issues.push(issue);
      else rows.push({ ...line, product_id: null, sub_recipe_id: subRecipe.id });
      continue;
    }

    const product = ingredient.product
      ? await insertProduct(trx, userId, ingredient.product)
      : await trx('products').where({ id: ingredient.productId, user_id: userId }).first();
    if (!product) {
      issues.push({ path: `body.ingredients[${index}].productId`, message: `Product ${ingredient.productId} does not exist` });
    } else if (!areCompatible(ingredient.unit, product.package_unit)) {
      issues.push(
        unitIssue(
          index,
          `"${product.name}" is measured in ${product.package_unit}, so the unit must be one of: ${compatibleUnits(product.package_unit).join(', ')}`,
        ),
      );
    } else {
      rows.push({ ...line, product_id: product.id, sub_recipe_id: null });
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

function checkYield(yieldQuantity, yieldUnit) {
  if ((yieldQuantity == null) !== (yieldUnit == null)) {
    throw new ValidationError([{ path: 'body.yieldUnit', message: 'Set yieldQuantity and yieldUnit together, or neither' }]);
  }
}

// A yield change must still fit the recipes that use this one by weight or volume.
async function checkYieldStillFits(trx, recipe, newYieldUnit) {
  if (newYieldUnit === recipe.yield_unit) return;
  const lines = await trx('recipe_ingredients as ri')
    .join('recipes as r', 'r.id', 'ri.recipe_id')
    .where('ri.sub_recipe_id', recipe.id)
    .whereNull('r.deleted_at')
    .whereNot('ri.unit', 'portion')
    .select('r.id', 'r.name', 'ri.unit');
  const conflicting = lines.filter((line) => !newYieldUnit || !areCompatible(line.unit, newYieldUnit));
  if (conflicting.length > 0) {
    const recipes = [...new Map(conflicting.map((line) => [line.id, { id: line.id, name: line.name }])).values()];
    throw new ConflictError(
      'UNIT_CONFLICT',
      `"${recipe.name}" is used by weight or volume in recipes that would no longer fit its yield. Change those recipes first.`,
      { recipes },
    );
  }
}

export async function listRecipes(userId, { search, category } = {}) {
  const ingredientCount = db('recipe_ingredients as ri')
    .count('*')
    .where('ri.recipe_id', db.ref('r.id'))
    .as('ingredient_count');
  const query = db('recipes as r')
    .where('r.user_id', userId)
    .whereNull('r.deleted_at')
    .select('r.*', ingredientCount)
    .orderBy('r.name');
  if (search) query.whereRaw('lower(r.name) like ?', [`%${search.toLowerCase()}%`]);
  if (category) query.where('r.category', await canonicalCategory(db, userId, 'recipe', category));
  const rows = await query;
  return rows.map(toRecipeSummaryDto);
}

export async function getRecipe(userId, id) {
  return loadRecipe(db, userId, id);
}

export async function listRecipesUsingThisRecipe(userId, id) {
  await findRecipeRow(db, userId, id);
  return recipesUsingRecipe(db, id);
}

export async function createRecipe(userId, data) {
  checkYield(data.yieldQuantity, data.yieldUnit);
  return db.transaction(async (trx) => {
    const [{ id }] = await trx('recipes')
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description ?? null,
        category: await canonicalCategory(trx, userId, 'recipe', data.category),
        portions: data.portions,
        sell_price: data.sellPrice ?? null,
        yield_quantity: data.yieldQuantity ?? null,
        yield_unit: data.yieldUnit ?? null,
      })
      .returning('id');
    await replaceIngredients(trx, userId, id, data.ingredients);
    await replaceSteps(trx, id, data.steps);
    await recalculateRecipeCosts(trx, [id], { reason: 'created', withParents: false });
    const after = await loadRecipeSnapshot(trx, id);
    await recordChange(trx, { userId, entityType: 'recipe', entityId: id, entityName: after.name, before: null, after });
    return loadRecipe(trx, userId, id);
  });
}

export async function updateRecipe(userId, id, data, { partial = false } = {}) {
  return db.transaction(async (trx) => {
    const current = await findRecipeRow(trx, userId, id);
    const before = await loadRecipeSnapshot(trx, id);

    const fields = {};
    if (!partial || data.name !== undefined) fields.name = data.name;
    if (!partial || data.description !== undefined) fields.description = data.description ?? null;
    if (!partial || data.category !== undefined) fields.category = await canonicalCategory(trx, userId, 'recipe', data.category);
    if (!partial || data.portions !== undefined) fields.portions = data.portions;
    if (!partial || data.sellPrice !== undefined) fields.sell_price = data.sellPrice ?? null;
    if (!partial || data.yieldQuantity !== undefined) fields.yield_quantity = data.yieldQuantity ?? null;
    if (!partial || data.yieldUnit !== undefined) fields.yield_unit = data.yieldUnit ?? null;

    const newYieldUnit = 'yield_unit' in fields ? fields.yield_unit : current.yield_unit;
    checkYield('yield_quantity' in fields ? fields.yield_quantity : current.yield_quantity, newYieldUnit);
    await checkYieldStillFits(trx, current, newYieldUnit);

    await trx('recipes').where({ id }).update({ ...fields, updated_at: trx.fn.now() });
    if (!partial || data.ingredients !== undefined) await replaceIngredients(trx, userId, id, data.ingredients);
    if (!partial || data.steps !== undefined) await replaceSteps(trx, id, data.steps);

    await recalculateRecipeCosts(trx, [id], { reason: 'recipe_updated', withParents: false });
    const after = await loadRecipeSnapshot(trx, id);
    const changeId = await recordChange(trx, { userId, entityType: 'recipe', entityId: id, entityName: after.name, before, after });

    // Its food cost, portions or yield may have changed the cost of recipes that use it.
    const parents = (await parentLinks(trx, [id])).map((link) => link.parent);
    await recalculateRecipeCosts(trx, parents, { reason: 'sub_recipe_changed', subRecipeId: id, causeChangeId: changeId });

    return loadRecipe(trx, userId, id);
  });
}

// Soft delete: ingredient lines, steps and cost history stay, so the recipe can be restored.
// A recipe that other (active) recipes use as a sub-recipe can't be deleted.
export async function deleteRecipe(userId, id) {
  await db.transaction(async (trx) => {
    const recipe = await findRecipeRow(trx, userId, id);
    const usedIn = await recipesUsingRecipe(trx, id);
    if (usedIn.length > 0) {
      throw new ConflictError(
        'RECIPE_IN_USE',
        `"${recipe.name}" is used in ${usedIn.length} recipe(s). Remove it from them first.`,
        { recipes: usedIn },
      );
    }
    const before = await loadRecipeSnapshot(trx, id);
    await trx('recipes').where({ id }).update({ deleted_at: trx.fn.now() });
    await recordChange(trx, { userId, entityType: 'recipe', entityId: id, entityName: before.name, before, after: null });
  });
}

/**
 * Restores a soft-deleted recipe and recalculates it with current prices. Ingredient lines that
 * can no longer be used are left out and reported in droppedIngredients:
 * - 'product_deleted': the product was deleted meanwhile (deleteProduct removed the line then).
 * - 'recipe_deleted': the sub-recipe was deleted meanwhile.
 * - 'unit_incompatible': the product's unit or the sub-recipe's yield changed to another kind
 *   (e.g. g -> piece, or the yield was removed) meanwhile.
 */
export async function restoreRecipe(userId, id) {
  return db.transaction(async (trx) => {
    const recipe = await trx('recipes').where({ id, user_id: userId }).first();
    if (!recipe) throw new NotFoundError('Recipe', id);
    if (recipe.deleted_at == null) {
      throw new ConflictError('RECIPE_NOT_DELETED', `Recipe "${recipe.name}" is not deleted`);
    }

    // The recipe as it was when deleted, from the change log.
    const deletion = await trx('change_log')
      .where({ user_id: userId, entity_type: 'recipe', entity_id: id, action: 'deleted' })
      .orderBy('id', 'desc')
      .first('changes');
    const before = deletion ? recipeSnapshotFromDeletion(JSON.parse(deletion.changes)) : await loadRecipeSnapshot(trx, id);

    const productLines = before.ingredients.filter((line) => line.productId != null);
    const existingProductIds = new Set(await trx('products').where('user_id', userId).whereIn('id', productLines.map((line) => line.productId)).pluck('id'));
    const dropped = productLines
      .filter((line) => !existingProductIds.has(line.productId))
      .map((line) => ({ ...line, reason: 'product_deleted' }));

    const lines = await trx('recipe_ingredients as ri')
      .leftJoin('products as p', 'p.id', 'ri.product_id')
      .leftJoin('recipes as s', 's.id', 'ri.sub_recipe_id')
      .where('ri.recipe_id', id)
      .orderBy('ri.position')
      .select(
        'ri.id',
        'ri.quantity',
        'ri.unit',
        'ri.product_id',
        'p.name as product_name',
        'p.package_unit',
        'ri.sub_recipe_id',
        's.name as recipe_name',
        's.deleted_at as recipe_deleted_at',
        's.yield_unit',
      );
    const unusable = [];
    for (const line of lines) {
      const amount = { quantity: line.quantity, unit: line.unit };
      if (line.product_id != null) {
        if (!areCompatible(line.unit, line.package_unit)) {
          unusable.push({ line, drop: { productId: line.product_id, productName: line.product_name, ...amount, reason: 'unit_incompatible' } });
        }
      } else if (line.recipe_deleted_at != null) {
        unusable.push({ line, drop: { recipeId: line.sub_recipe_id, recipeName: line.recipe_name, ...amount, reason: 'recipe_deleted' } });
      } else if (!subRecipeUnits(line.yield_unit).includes(line.unit)) {
        unusable.push({ line, drop: { recipeId: line.sub_recipe_id, recipeName: line.recipe_name, ...amount, reason: 'unit_incompatible' } });
      }
    }
    if (unusable.length > 0) {
      await trx('recipe_ingredients').whereIn('id', unusable.map(({ line }) => line.id)).del();
      dropped.push(...unusable.map(({ drop }) => drop));
    }

    // Nothing active can use a deleted recipe, so restoring it changes no other recipe.
    await trx('recipes').where({ id }).update({ deleted_at: null, updated_at: trx.fn.now() });
    await recalculateRecipeCosts(trx, [id], { reason: 'recipe_restored', withParents: false });
    const after = await loadRecipeSnapshot(trx, id);
    await recordChange(trx, { userId, entityType: 'recipe', entityId: id, entityName: after.name, before, after, action: 'restored' });

    return { recipe: await loadRecipe(trx, userId, id), droppedIngredients: dropped };
  });
}
