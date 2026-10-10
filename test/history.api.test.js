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

// Reference recipe: 10.00 + 0.90 + 2.40 = 13.30, 1.33 per portion.
async function createTart(name = 'Shortcrust tart base') {
  const res = await api
    .post('/api/v1/recipes')
    .send({
      name,
      portions: 10,
      ingredients: [
        { productId: butter.id, quantity: 250, unit: 'g' },
        { productId: flour.id, quantity: 300, unit: 'g' },
        { productId: eggs.id, quantity: 2, unit: 'piece' },
      ],
    })
    .expect(201);
  return res.body;
}

async function priceHistory(productId) {
  return (await api.get(`/api/v1/products/${productId}/price-history`).expect(200)).body.items;
}

async function costHistory(recipeId) {
  return (await api.get(`/api/v1/recipes/${recipeId}/cost-history`).expect(200)).body.items;
}

describe('product price history', () => {
  it('starts with the price at creation', async () => {
    const [entry, ...rest] = await priceHistory(butter.id);

    assert.equal(rest.length, 0);
    assert.equal(entry.reason, 'created');
    assert.equal(entry.pricePerPackage, 8);
    assert.equal(entry.pricePerUnit, 40);
    assert.equal(entry.pricingUnit, 'kg');
    assert.equal(entry.packageSize, 200);
    assert.equal(entry.packageUnit, 'g');
    assert.equal(entry.previous, null);
    assert.deepEqual(entry.affectedRecipes, []);
    assert.ok(entry.changedAt.endsWith('Z'));
  });

  it('records each price change, newest first, with the recipes it affected', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerUnit: 45 }).expect(200);

    const history = await priceHistory(butter.id);

    assert.deepEqual(history.map((entry) => [entry.reason, entry.pricePerPackage]), [
      ['updated', 9],
      ['updated', 10],
      ['created', 8],
    ]);
    assert.deepEqual(history[1].previous, { packageSize: 200, packageUnit: 'g', pricePerPackage: 8, pricePerUnit: 40, pricingUnit: 'kg' });
    assert.equal(history[1].pricePerUnit, 50);
    assert.deepEqual(history[1].affectedRecipes, [
      { id: tart.id, name: 'Shortcrust tart base', previousFoodCost: 13.3, foodCost: 15.8 },
    ]);
    assert.deepEqual(history[0].affectedRecipes, [
      { id: tart.id, name: 'Shortcrust tart base', previousFoodCost: 15.8, foodCost: 14.55 },
    ]);
  });

  it('ignores changes that do not touch the price', async () => {
    await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 84%', inventoryQuantity: 0 }).expect(200);

    assert.equal((await priceHistory(butter.id)).length, 1);
  });

  it('records a package change even when the recipe costs stay the same', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ packageSize: 0.2, packageUnit: 'kg' }).expect(200);

    const [entry] = await priceHistory(butter.id);
    assert.equal(entry.packageUnit, 'kg');
    assert.equal(entry.previous.packageUnit, 'g');
    assert.equal(entry.pricePerUnit, 40);
    assert.deepEqual(entry.affectedRecipes, []);
    assert.equal((await costHistory(tart.id)).length, 1);
  });

  it('starts the history of a product created inline in a recipe', async () => {
    const res = await api
      .post('/api/v1/recipes')
      .send({
        name: 'Sugar syrup',
        portions: 1,
        ingredients: [{ product: { name: 'Caster sugar', packageSize: 1, packageUnit: 'kg', pricePerPackage: 4.5 }, quantity: 100, unit: 'g' }],
      })
      .expect(201);

    const history = await priceHistory(res.body.ingredients[0].productId);
    assert.deepEqual(history.map((entry) => entry.reason), ['created']);
  });

  it('returns 404 for an unknown product', async () => {
    await api.get('/api/v1/products/9999/price-history').expect(404);
  });
});

describe('recipe cost history', () => {
  it('starts with the cost at creation', async () => {
    const tart = await createTart();

    const [entry, ...rest] = await costHistory(tart.id);
    assert.equal(rest.length, 0);
    assert.equal(entry.reason, 'created');
    assert.equal(entry.foodCost, 13.3);
    assert.equal(entry.costPerPortion, 1.33);
    assert.equal(entry.portions, 10);
    assert.equal(entry.previous, null);
    assert.equal(entry.cause, null);
  });

  it('records a cost change caused by a product price change and names the cause', async () => {
    const tart = await createTart();
    const update = await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);
    assert.equal(update.body.recalculatedRecipes[0].foodCost, 15.8);

    const [entry] = await costHistory(tart.id);
    const [priceChange] = await priceHistory(butter.id);

    assert.equal(entry.reason, 'product_price_changed');
    assert.equal(entry.foodCost, 15.8);
    assert.equal(entry.costPerPortion, 1.58);
    assert.deepEqual(entry.previous, { portions: 10, foodCost: 13.3, costPerPortion: 1.33 });
    assert.deepEqual(entry.cause, {
      priceChangeId: priceChange.id,
      productId: butter.id,
      productName: 'Butter 82%',
      previousPricePerPackage: 8,
      pricePerPackage: 10,
      previousPricePerUnit: 40,
      pricePerUnit: 50,
      pricingUnit: 'kg',
    });
  });

  it('records recipe edits that change the cost or the portions', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/recipes/${tart.id}`).send({ portions: 4 }).expect(200);
    await api
      .patch(`/api/v1/recipes/${tart.id}`)
      .send({ ingredients: [{ productId: flour.id, quantity: 500, unit: 'g' }] })
      .expect(200);

    const history = await costHistory(tart.id);

    assert.deepEqual(
      history.map(({ reason, portions, foodCost, costPerPortion }) => ({ reason, portions, foodCost, costPerPortion })),
      [
        { reason: 'recipe_updated', portions: 4, foodCost: 1.5, costPerPortion: 0.38 },
        { reason: 'recipe_updated', portions: 4, foodCost: 13.3, costPerPortion: 3.33 },
        { reason: 'created', portions: 10, foodCost: 13.3, costPerPortion: 1.33 },
      ],
    );
    assert.equal(history[0].cause, null);
  });

  it('ignores recipe edits that do not change the cost', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/recipes/${tart.id}`).send({ name: 'Tart base', steps: ['Mix'] }).expect(200);

    assert.equal((await costHistory(tart.id)).length, 1);
  });

  it('shows the current product name after a rename', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);
    await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 84%' }).expect(200);

    const [entry] = await costHistory(tart.id);
    assert.equal(entry.cause.productName, 'Butter 84%');
  });

  it('keeps the cause after the product is deleted', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);
    await api
      .patch(`/api/v1/recipes/${tart.id}`)
      .send({ ingredients: [{ productId: flour.id, quantity: 300, unit: 'g' }] })
      .expect(200);
    await api.delete(`/api/v1/products/${butter.id}`).expect(204);

    const history = await costHistory(tart.id);
    const priceChangeEntry = history.find((entry) => entry.reason === 'product_price_changed');
    assert.equal(priceChangeEntry.cause.productId, null);
    assert.equal(priceChangeEntry.cause.productName, 'Butter 82%');
    assert.equal(priceChangeEntry.cause.pricePerPackage, 10);
  });

  it('is hidden while the recipe is deleted and comes back on restore', async () => {
    const tart = await createTart();
    await api.delete(`/api/v1/recipes/${tart.id}`).expect(204);
    await api.get(`/api/v1/recipes/${tart.id}/cost-history`).expect(404);

    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);
    await api.post(`/api/v1/recipes/${tart.id}/restore`).expect(200);

    const history = await costHistory(tart.id);
    assert.deepEqual(
      history.map(({ reason, foodCost, cause }) => ({ reason, foodCost, cause })),
      [
        { reason: 'recipe_restored', foodCost: 15.8, cause: null },
        { reason: 'created', foodCost: 13.3, cause: null },
      ],
    );
  });
});
