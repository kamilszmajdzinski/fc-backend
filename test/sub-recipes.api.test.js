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
  butter = await createProduct(api, sampleProducts.butter); // 0.04 / g
  flour = await createProduct(api, sampleProducts.flour); // 0.003 / g
  eggs = await createProduct(api, sampleProducts.eggs); // 1.20 / piece
});
after(() => db.destroy());

async function createRecipe(data) {
  return (await api.post('/api/v1/recipes').send(data).expect(201)).body;
}

// Crumble: 4.00 + 0.60 = 4.60 for 4 portions (1.15 each), yields 300 g (0.015333 / g).
function createCrumble() {
  return createRecipe({
    name: 'Crumble',
    portions: 4,
    yieldQuantity: 300,
    yieldUnit: 'g',
    ingredients: [
      { productId: butter.id, quantity: 100, unit: 'g' },
      { productId: flour.id, quantity: 200, unit: 'g' },
    ],
  });
}

// Tart: 2.40 eggs + 150 g crumble (2.30) = 4.70, 1 portion.
function createTart(crumble) {
  return createRecipe({
    name: 'Tart',
    portions: 1,
    ingredients: [
      { productId: eggs.id, quantity: 2, unit: 'piece' },
      { recipeId: crumble.id, quantity: 150, unit: 'g' },
    ],
  });
}

async function costHistory(id) {
  return (await api.get(`/api/v1/recipes/${id}/cost-history`).expect(200)).body.items;
}

async function changes(type, id) {
  return (await api.get(`/api/v1/${type}/${id}/changes`).expect(200)).body.items;
}

describe('using a recipe as an ingredient', () => {
  it('prices a sub-recipe by weight through its yield', async () => {
    const crumble = await createCrumble();
    assert.equal(crumble.yieldQuantity, 300);
    assert.equal(crumble.yieldUnit, 'g');

    const tart = await createTart(crumble);

    assert.equal(tart.foodCost, 4.7);
    assert.deepEqual(tart.ingredients[1], {
      id: tart.ingredients[1].id,
      type: 'recipe',
      productId: null,
      productName: null,
      recipeId: crumble.id,
      recipeName: 'Crumble',
      name: 'Crumble',
      quantity: 150,
      unit: 'g',
      unitPrice: 0.015333,
      cost: 2.3,
    });
    assert.equal(tart.ingredients[0].type, 'product');
    assert.equal(tart.ingredients[0].name, 'Eggs L');
  });

  it('prices a sub-recipe by portions', async () => {
    const crumble = await createCrumble();
    const tart = await createRecipe({ name: 'Tart', portions: 1, ingredients: [{ recipeId: crumble.id, quantity: 2, unit: 'portion' }] });

    assert.equal(tart.foodCost, 2.3);
    assert.equal(tart.ingredients[0].unitPrice, 1.15);
  });

  it('accepts the body of a GET back as a PUT', async () => {
    const tart = await createTart(await createCrumble());
    const res = await api.put(`/api/v1/recipes/${tart.id}`).send(tart).expect(200);
    assert.equal(res.body.foodCost, 4.7);
  });

  it('rejects units that do not fit', async () => {
    const crumble = await createCrumble();
    const noYield = await createRecipe({ name: 'Glaze', portions: 2, ingredients: [{ productId: flour.id, quantity: 10, unit: 'g' }] });

    const res = await api
      .post('/api/v1/recipes')
      .send({
        name: 'Tart',
        portions: 1,
        ingredients: [
          { productId: butter.id, quantity: 1, unit: 'portion' },
          { recipeId: crumble.id, quantity: 100, unit: 'ml' },
          { recipeId: noYield.id, quantity: 100, unit: 'g' },
          { recipeId: noYield.id, quantity: 1, unit: 'portion' },
        ],
      })
      .expect(400);

    assert.deepEqual(
      res.body.error.details.issues.map(({ path, message }) => [path, message]),
      [
        ['body.ingredients[0].unit', '"Butter 82%" is measured in g, so the unit must be one of: mg, g, kg'],
        ['body.ingredients[1].unit', '"Crumble" yields 300 g, so the unit must be one of: portion, mg, g, kg'],
        ['body.ingredients[2].unit', '"Glaze" has no yield, so it can only be used in portions'],
      ],
    );
  });

  it('rejects unknown or deleted recipes and lines with two sources', async () => {
    const crumble = await createCrumble();
    await api.delete(`/api/v1/recipes/${crumble.id}`).expect(204);

    const res = await api
      .post('/api/v1/recipes')
      .send({
        name: 'Tart',
        portions: 1,
        ingredients: [
          { recipeId: 9999, quantity: 1, unit: 'portion' },
          { recipeId: crumble.id, quantity: 1, unit: 'portion' },
        ],
      })
      .expect(400);
    assert.deepEqual(res.body.error.details.issues.map((issue) => issue.message), [
      'Recipe 9999 does not exist',
      `Recipe ${crumble.id} does not exist`,
    ]);

    const both = await api
      .post('/api/v1/recipes')
      .send({ name: 'Tart', portions: 1, ingredients: [{ productId: butter.id, recipeId: 1, quantity: 1, unit: 'g' }] })
      .expect(400);
    assert.equal(both.body.error.details.issues[0].path, 'body.ingredients[0].productId');
  });

  it('requires yieldQuantity and yieldUnit together', async () => {
    await api.post('/api/v1/recipes').send({ name: 'X', portions: 1, yieldQuantity: 100 }).expect(400);
    const crumble = await createCrumble();
    const res = await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldUnit: null }).expect(400);
    assert.equal(res.body.error.details.issues[0].path, 'body.yieldUnit');

    const cleared = await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldQuantity: null, yieldUnit: null }).expect(200);
    assert.equal(cleared.body.yieldQuantity, null);
  });
});

describe('loops', () => {
  it('stops a recipe from using itself, directly or through other recipes', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);
    const bigTart = await createRecipe({ name: 'Big tart', portions: 1, ingredients: [{ recipeId: tart.id, quantity: 2, unit: 'portion' }] });

    const self = await api
      .patch(`/api/v1/recipes/${crumble.id}`)
      .send({ ingredients: [{ recipeId: crumble.id, quantity: 1, unit: 'portion' }] })
      .expect(400);
    assert.equal(self.body.error.details.issues[0].message, 'A recipe cannot use itself');

    const indirect = await api
      .patch(`/api/v1/recipes/${crumble.id}`)
      .send({ ingredients: [{ recipeId: bigTart.id, quantity: 1, unit: 'portion' }] })
      .expect(400);
    assert.equal(indirect.body.error.details.issues[0].message, '"Big tart" already uses this recipe, so this recipe cannot use it');
  });
});

describe('cost changes flow up', () => {
  it('recalculates every level after a product price change and links the whole chain', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);
    const bigTart = await createRecipe({ name: 'Big tart', portions: 1, ingredients: [{ recipeId: tart.id, quantity: 2, unit: 'portion' }] });
    assert.equal(bigTart.foodCost, 9.4);

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);

    assert.deepEqual(
      res.body.recalculatedRecipes.map(({ name, previousFoodCost, foodCost }) => [name, previousFoodCost, foodCost]),
      [
        ['Big tart', 9.4, 10.4],
        ['Crumble', 4.6, 5.6],
        ['Tart', 4.7, 5.2],
      ],
    );
    assert.equal((await api.get(`/api/v1/recipes/${bigTart.id}`).expect(200)).body.foodCost, 10.4);

    // Cost history: every level points at the butter price change, upper levels also at the sub-recipe.
    const [bigTartEntry] = await costHistory(bigTart.id);
    assert.equal(bigTartEntry.reason, 'product_price_changed');
    assert.equal(bigTartEntry.cause.productName, 'Butter 82%');
    assert.deepEqual(bigTartEntry.subRecipe, { id: tart.id, name: 'Tart' });
    const [crumbleEntry] = await costHistory(crumble.id);
    assert.equal(crumbleEntry.subRecipe, null);

    // Change log: butter -> crumble -> tart -> big tart.
    const [butterChange] = await changes('products', butter.id);
    assert.deepEqual(butterChange.triggered.map((entry) => entry.entityName), ['Crumble']);
    const [crumbleChange] = await changes('recipes', crumble.id);
    assert.deepEqual(crumbleChange.triggered.map((entry) => entry.entityName), ['Tart']);
    const [bigTartChange] = await changes('recipes', bigTart.id);
    assert.equal(bigTartChange.triggeredBy.entityName, 'Tart');
    assert.deepEqual(bigTartChange.changes, [{ field: 'foodCost', from: 9.4, to: 10.4 }]);

    // The product's price history lists every recipe whose cost changed.
    const [priceChange] = (await api.get(`/api/v1/products/${butter.id}/price-history`).expect(200)).body.items;
    assert.deepEqual(priceChange.affectedRecipes.map((recipe) => recipe.name), ['Big tart', 'Crumble', 'Tart']);
  });

  it('recalculates a recipe that uses a product both directly and through a sub-recipe once', async () => {
    const crumble = await createCrumble();
    // 50 g butter (2.00) + 1 portion crumble (1.15) = 3.15
    const butterTart = await createRecipe({
      name: 'Butter tart',
      portions: 1,
      ingredients: [
        { recipeId: crumble.id, quantity: 1, unit: 'portion' },
        { productId: butter.id, quantity: 50, unit: 'g' },
      ],
    });
    assert.equal(butterTart.foodCost, 3.15);

    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);

    // 2.50 + 5.60 / 4 = 3.90, reached in one step.
    const history = await costHistory(butterTart.id);
    assert.deepEqual(history.map((entry) => entry.foodCost), [3.9, 3.15]);
  });

  it('updates recipes that use a sub-recipe when the sub-recipe changes', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);

    // A bigger yield makes each gram cheaper: 4.60 / 400 g * 150 g = 1.725, so 2.40 + 1.725 = 4.13.
    await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldQuantity: 400 }).expect(200);

    const [entry] = await costHistory(tart.id);
    assert.equal(entry.reason, 'sub_recipe_changed');
    assert.equal(entry.foodCost, 4.13);
    assert.deepEqual(entry.subRecipe, { id: crumble.id, name: 'Crumble' });
    assert.equal(entry.cause, null);

    const [tartChange] = await changes('recipes', tart.id);
    assert.equal(tartChange.triggeredBy.entityName, 'Crumble');
    assert.deepEqual(tartChange.triggeredBy.changes, [{ field: 'yieldQuantity', from: 300, to: 400 }]);
  });

  it('updates recipes that use a sub-recipe by portions when its portions change', async () => {
    const crumble = await createCrumble();
    const tart = await createRecipe({ name: 'Tart', portions: 1, ingredients: [{ recipeId: crumble.id, quantity: 2, unit: 'portion' }] });

    await api.patch(`/api/v1/recipes/${crumble.id}`).send({ portions: 2 }).expect(200);

    assert.equal((await api.get(`/api/v1/recipes/${tart.id}`).expect(200)).body.foodCost, 4.6);
  });
});

describe('rules for recipes that are used elsewhere', () => {
  it('lists where a recipe is used', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);

    const res = await api.get(`/api/v1/recipes/${crumble.id}/used-in`).expect(200);
    assert.deepEqual(res.body.items, [{ id: tart.id, name: 'Tart' }]);
  });

  it('blocks deleting a recipe that other recipes use', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);

    const res = await api.delete(`/api/v1/recipes/${crumble.id}`).expect(409);
    assert.equal(res.body.error.code, 'RECIPE_IN_USE');
    assert.deepEqual(res.body.error.details.recipes, [{ id: tart.id, name: 'Tart' }]);

    await api.delete(`/api/v1/recipes/${tart.id}`).expect(204);
    await api.delete(`/api/v1/recipes/${crumble.id}`).expect(204);
  });

  it('blocks a yield change that no longer fits recipes using it by weight', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);

    const removed = await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldQuantity: null, yieldUnit: null }).expect(409);
    assert.equal(removed.body.error.code, 'UNIT_CONFLICT');
    assert.deepEqual(removed.body.error.details.recipes, [{ id: tart.id, name: 'Tart' }]);
    await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldUnit: 'ml' }).expect(409);

    // Same kind is fine: 0.3 kg is still 300 g.
    await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldQuantity: 0.3, yieldUnit: 'kg' }).expect(200);
    assert.equal((await api.get(`/api/v1/recipes/${tart.id}`).expect(200)).body.foodCost, 4.7);
  });

  it('allows removing the yield when the recipe is only used by portions', async () => {
    const crumble = await createCrumble();
    await createRecipe({ name: 'Tart', portions: 1, ingredients: [{ recipeId: crumble.id, quantity: 2, unit: 'portion' }] });

    await api.patch(`/api/v1/recipes/${crumble.id}`).send({ yieldQuantity: null, yieldUnit: null }).expect(200);
  });

  it('drops a deleted sub-recipe when restoring a recipe and reports it', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);
    await api.delete(`/api/v1/recipes/${tart.id}`).expect(204);
    await api.delete(`/api/v1/recipes/${crumble.id}`).expect(204);

    const res = await api.post(`/api/v1/recipes/${tart.id}/restore`).expect(200);

    assert.deepEqual(res.body.droppedIngredients, [
      { recipeId: crumble.id, recipeName: 'Crumble', quantity: 150, unit: 'g', reason: 'recipe_deleted' },
    ]);
    assert.equal(res.body.recipe.foodCost, 2.4);
  });

  it('logs sub-recipe lines and the yield in the change log', async () => {
    const crumble = await createCrumble();
    const tart = await createTart(crumble);

    const [created] = await changes('recipes', tart.id);
    const ingredients = created.changes.find((change) => change.field === 'ingredients').to;
    assert.deepEqual(ingredients[1], { recipeId: crumble.id, recipeName: 'Crumble', quantity: 150, unit: 'g' });

    const [crumbleCreated] = await changes('recipes', crumble.id);
    assert.deepEqual(
      crumbleCreated.changes.filter((change) => change.field.startsWith('yield')),
      [
        { field: 'yieldQuantity', from: null, to: 300 },
        { field: 'yieldUnit', from: null, to: 'g' },
      ],
    );
  });
});
