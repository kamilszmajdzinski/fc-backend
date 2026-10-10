import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createProduct, db, resetDatabase, sampleProducts, setupApi } from './helpers.js';

let api;
let butter;
let flour;
let eggs;

before(async () => {
  api = await setupApi();
});
beforeEach(async () => {
  await resetDatabase();
  butter = await createProduct(api, sampleProducts.butter);
  flour = await createProduct(api, sampleProducts.flour);
  eggs = await createProduct(api, sampleProducts.eggs);
});
after(() => db.destroy());

// Reference recipe: 10.00 + 0.90 + 2.40 = 13.30.
function tartInput() {
  return {
    name: 'Shortcrust tart base',
    portions: 10,
    ingredients: [
      { productId: butter.id, quantity: 250, unit: 'g' },
      { productId: flour.id, quantity: 300, unit: 'g' },
      { productId: eggs.id, quantity: 2, unit: 'piece' },
    ],
    steps: ['Mix', 'Chill'],
  };
}

async function createTart() {
  return (await api.post('/api/v1/recipes').send(tartInput()).expect(201)).body;
}

async function deleteRecipe(id) {
  await api.delete(`/api/v1/recipes/${id}`).expect(204);
}

async function restore(id) {
  return (await api.post(`/api/v1/recipes/${id}/restore`).expect(200)).body;
}

async function recipeChanges(id) {
  return (await api.get(`/api/v1/recipes/${id}/changes`).expect(200)).body.items;
}

describe('recipe soft delete', () => {
  it('hides a deleted recipe but keeps its data', async () => {
    const tart = await createTart();
    await deleteRecipe(tart.id);

    await api.get(`/api/v1/recipes/${tart.id}`).expect(404);
    await api.patch(`/api/v1/recipes/${tart.id}`).send({ portions: 2 }).expect(404);
    await api.put(`/api/v1/recipes/${tart.id}`).send(tartInput()).expect(404);
    await api.delete(`/api/v1/recipes/${tart.id}`).expect(404);
    assert.deepEqual((await api.get('/api/v1/recipes').expect(200)).body.items, []);
    assert.deepEqual((await api.get(`/api/v1/products/${butter.id}/recipes`).expect(200)).body.items, []);

    const row = await db('recipes').where('id', tart.id).first();
    assert.ok(row.deleted_at);
    assert.equal((await db('recipe_ingredients').where('recipe_id', tart.id)).length, 3);
    assert.equal((await db('recipe_steps').where('recipe_id', tart.id)).length, 2);

    const [entry] = await recipeChanges(tart.id);
    assert.equal(entry.action, 'deleted');
  });

  it('does not recalculate a deleted recipe or let it block product changes', async () => {
    const tart = await createTart();
    await deleteRecipe(tart.id);

    const priceChange = await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);
    assert.deepEqual(priceChange.body.recalculatedRecipes, []);
    const row = await db('recipes').where('id', tart.id).first();
    assert.ok(Math.abs(row.food_cost - 13.3) < 1e-9);
    assert.equal((await db('recipe_cost_history').where('recipe_id', tart.id)).length, 1);

    // A unit kind change is not blocked by the deleted recipe that uses eggs by the piece.
    await api.patch(`/api/v1/products/${eggs.id}`).send({ packageSize: 0.6, packageUnit: 'kg' }).expect(200);
  });
});

describe('restore', () => {
  it('brings back the same recipe, recalculated with current prices', async () => {
    const tart = await createTart();
    await deleteRecipe(tart.id);
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);

    const { recipe, droppedIngredients } = await restore(tart.id);

    assert.equal(recipe.id, tart.id);
    assert.equal(recipe.foodCost, 15.8);
    assert.deepEqual(recipe.ingredients.map((line) => line.productId), [butter.id, flour.id, eggs.id]);
    assert.deepEqual(recipe.steps, ['Mix', 'Chill']);
    assert.deepEqual(droppedIngredients, []);
    assert.equal((await api.get(`/api/v1/recipes/${tart.id}`).expect(200)).body.foodCost, 15.8);
    assert.equal((await api.get('/api/v1/recipes').expect(200)).body.items.length, 1);

    const [restored] = await recipeChanges(tart.id);
    assert.equal(restored.action, 'restored');
    assert.deepEqual(restored.changes, [{ field: 'foodCost', from: 13.3, to: 15.8 }]);
  });

  it('logs a restore without changes when nothing changed meanwhile', async () => {
    const tart = await createTart();
    await deleteRecipe(tart.id);
    await restore(tart.id);
    await deleteRecipe(tart.id);
    await restore(tart.id);

    const history = await recipeChanges(tart.id);
    assert.deepEqual(history.map((entry) => entry.action), ['restored', 'deleted', 'restored', 'deleted', 'created']);
    assert.deepEqual(history[0].changes, []);
  });

  it('leaves out lines whose product was deleted and reports them', async () => {
    const tart = await createTart();
    await deleteRecipe(tart.id);
    await api.delete(`/api/v1/products/${butter.id}`).expect(204);

    const { recipe, droppedIngredients } = await restore(tart.id);

    assert.deepEqual(droppedIngredients, [
      { productId: butter.id, productName: 'Butter 82%', quantity: 250, unit: 'g', reason: 'product_deleted' },
    ]);
    assert.deepEqual(recipe.ingredients.map((line) => line.productId), [flour.id, eggs.id]);
    assert.equal(recipe.foodCost, 3.3);

    const [restored] = await recipeChanges(tart.id);
    assert.deepEqual(restored.changes.map((change) => change.field), ['ingredients', 'foodCost']);
    assert.equal(restored.changes[0].from.length, 3);
    assert.equal(restored.changes[0].to.length, 2);
  });

  it('leaves out lines whose product unit changed to another kind and reports them', async () => {
    const tart = await createTart();
    await deleteRecipe(tart.id);
    await api.patch(`/api/v1/products/${eggs.id}`).send({ packageSize: 0.6, packageUnit: 'kg' }).expect(200);

    const { recipe, droppedIngredients } = await restore(tart.id);

    assert.deepEqual(droppedIngredients, [
      { productId: eggs.id, productName: 'Eggs L', quantity: 2, unit: 'piece', reason: 'unit_incompatible' },
    ]);
    assert.equal(recipe.ingredients.length, 2);
    assert.equal(recipe.foodCost, 10.9);
  });

  it('returns 404 for an unknown recipe and 409 for one that is not deleted', async () => {
    await api.post('/api/v1/recipes/9999/restore').expect(404);

    const tart = await createTart();
    const res = await api.post(`/api/v1/recipes/${tart.id}/restore`).expect(409);
    assert.equal(res.body.error.code, 'RECIPE_NOT_DELETED');
  });
});
