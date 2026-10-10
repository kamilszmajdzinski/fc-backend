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
  butter = await createProduct(api, { ...sampleProducts.butter, description: 'Unsalted' });
  flour = await createProduct(api, sampleProducts.flour);
  eggs = await createProduct(api, sampleProducts.eggs);
});
after(() => db.destroy());

// Reference recipe: 10.00 + 0.90 + 2.40 = 13.30.
async function createTart() {
  const res = await api
    .post('/api/v1/recipes')
    .send({
      name: 'Shortcrust tart base',
      portions: 10,
      ingredients: [
        { productId: butter.id, quantity: 250, unit: 'g' },
        { productId: flour.id, quantity: 300, unit: 'g' },
        { productId: eggs.id, quantity: 2, unit: 'piece' },
      ],
      steps: ['Mix', 'Chill'],
    })
    .expect(201);
  return res.body;
}

async function productChanges(id) {
  return (await api.get(`/api/v1/products/${id}/changes`).expect(200)).body.items;
}

async function recipeChanges(id) {
  return (await api.get(`/api/v1/recipes/${id}/changes`).expect(200)).body.items;
}

// { field: [from, to] } for compact assertions.
function byField(entry) {
  return Object.fromEntries(entry.changes.map(({ field, from, to }) => [field, [from, to]]));
}

describe('product change log', () => {
  it('logs creation with the initial values', async () => {
    const [entry, ...rest] = await productChanges(butter.id);

    assert.equal(rest.length, 0);
    assert.equal(entry.action, 'created');
    assert.equal(entry.entityType, 'product');
    assert.equal(entry.entityId, butter.id);
    assert.equal(entry.entityName, 'Butter 82%');
    assert.deepEqual(byField(entry), {
      name: [null, 'Butter 82%'],
      description: [null, 'Unsalted'],
      manufacturer: [null, 'Dairy Co.'],
      packageSize: [null, 200],
      packageUnit: [null, 'g'],
      pricePerPackage: [null, 8],
      pricePerUnit: [null, 40],
      inventoryQuantity: [null, 1000],
    });
    assert.equal(entry.triggeredBy, null);
    assert.deepEqual(entry.triggered, []);
  });

  it('logs only the fields that changed', async () => {
    await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 84%', description: null, inventoryQuantity: 1000 }).expect(200);

    const [entry] = await productChanges(butter.id);
    assert.equal(entry.action, 'updated');
    assert.equal(entry.entityName, 'Butter 84%');
    assert.deepEqual(byField(entry), { name: ['Butter 82%', 'Butter 84%'], description: ['Unsalted', null] });
  });

  it('does not log a save that changes nothing', async () => {
    await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 82%' }).expect(200);
    await api.put(`/api/v1/products/${butter.id}`).send({ ...sampleProducts.butter, description: 'Unsalted' }).expect(200);

    assert.equal((await productChanges(butter.id)).length, 1);
  });

  it('links a price change to the recipe food cost changes it caused', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);

    const [productEntry] = await productChanges(butter.id);
    assert.deepEqual(byField(productEntry), { pricePerPackage: [8, 10], pricePerUnit: [40, 50] });
    assert.equal(productEntry.triggered.length, 1);
    assert.equal(productEntry.triggered[0].entityId, tart.id);
    assert.deepEqual(byField(productEntry.triggered[0]), { foodCost: [13.3, 15.8] });

    const [recipeEntry] = await recipeChanges(tart.id);
    assert.equal(recipeEntry.action, 'updated');
    assert.deepEqual(byField(recipeEntry), { foodCost: [13.3, 15.8] });
    assert.equal(recipeEntry.triggeredBy.id, productEntry.id);
    assert.equal(recipeEntry.triggeredBy.entityName, 'Butter 82%');
    assert.deepEqual(byField(recipeEntry.triggeredBy), { pricePerPackage: [8, 10], pricePerUnit: [40, 50] });
  });

  it('does not log anything on recipes when a product is renamed', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 84%' }).expect(200);

    assert.equal((await recipeChanges(tart.id)).length, 1);
  });

  it('logs a deletion and keeps the log readable afterwards', async () => {
    await api.delete(`/api/v1/products/${flour.id}`).expect(204);

    const [entry] = await productChanges(flour.id);
    assert.equal(entry.action, 'deleted');
    assert.equal(entry.entityName, 'Wheat flour');
    assert.deepEqual(byField(entry).pricePerPackage, [3, null]);
  });

  it('logs products created inline in a recipe', async () => {
    const res = await api
      .post('/api/v1/recipes')
      .send({
        name: 'Sugar syrup',
        portions: 1,
        ingredients: [{ product: { name: 'Caster sugar', packageSize: 1, packageUnit: 'kg', pricePerPackage: 4.5 }, quantity: 100, unit: 'g' }],
      })
      .expect(201);

    const [entry] = await productChanges(res.body.ingredients[0].productId);
    assert.equal(entry.action, 'created');
    assert.equal(entry.entityName, 'Caster sugar');
  });

  it('returns 404 for an id that never existed', async () => {
    await api.get('/api/v1/products/9999/changes').expect(404);
  });
});

describe('recipe change log', () => {
  it('logs creation with ingredients, steps and food cost', async () => {
    const tart = await createTart();

    const [entry] = await recipeChanges(tart.id);
    assert.equal(entry.action, 'created');
    assert.deepEqual(byField(entry), {
      name: [null, 'Shortcrust tart base'],
      portions: [null, 10],
      ingredients: [
        null,
        [
          { productId: butter.id, productName: 'Butter 82%', quantity: 250, unit: 'g' },
          { productId: flour.id, productName: 'Wheat flour', quantity: 300, unit: 'g' },
          { productId: eggs.id, productName: 'Eggs L', quantity: 2, unit: 'piece' },
        ],
      ],
      steps: [null, ['Mix', 'Chill']],
      foodCost: [null, 13.3],
    });
  });

  it('logs an ingredient change together with the resulting food cost', async () => {
    const tart = await createTart();
    await api
      .patch(`/api/v1/recipes/${tart.id}`)
      .send({
        ingredients: [
          { productId: butter.id, quantity: 300, unit: 'g' },
          { productId: flour.id, quantity: 300, unit: 'g' },
        ],
      })
      .expect(200);

    const [entry] = await recipeChanges(tart.id);
    const changes = byField(entry);
    assert.deepEqual(Object.keys(changes), ['ingredients', 'foodCost']);
    assert.equal(changes.ingredients[0].length, 3);
    assert.deepEqual(changes.ingredients[1][0], { productId: butter.id, productName: 'Butter 82%', quantity: 300, unit: 'g' });
    assert.deepEqual(changes.foodCost, [13.3, 12.9]);
    assert.equal(entry.triggeredBy, null);
  });

  it('logs name, description, portions and steps', async () => {
    const tart = await createTart();
    await api
      .patch(`/api/v1/recipes/${tart.id}`)
      .send({ name: 'Tart base', description: 'Sweet', portions: 12, steps: ['Mix', 'Rest', 'Chill'] })
      .expect(200);

    const [entry] = await recipeChanges(tart.id);
    assert.deepEqual(byField(entry), {
      name: ['Shortcrust tart base', 'Tart base'],
      description: [null, 'Sweet'],
      portions: [10, 12],
      steps: [['Mix', 'Chill'], ['Mix', 'Rest', 'Chill']],
    });
  });

  it('logs sell price changes', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/recipes/${tart.id}`).send({ sellPrice: 60 }).expect(200);
    await api.patch(`/api/v1/recipes/${tart.id}`).send({ sellPrice: null }).expect(200);

    const [cleared, set] = await recipeChanges(tart.id);
    assert.deepEqual(byField(set), { sellPrice: [null, 60] });
    assert.deepEqual(byField(cleared), { sellPrice: [60, null] });
  });

  it('does not log a save that changes nothing', async () => {
    const tart = await createTart();
    await api.put(`/api/v1/recipes/${tart.id}`).send(tart).expect(200);

    assert.equal((await recipeChanges(tart.id)).length, 1);
  });

  it('logs nothing when the save fails', async () => {
    const tart = await createTart();
    await api
      .patch(`/api/v1/recipes/${tart.id}`)
      .send({ name: 'Broken', ingredients: [{ productId: butter.id, quantity: 1, unit: 'ml' }] })
      .expect(400);

    assert.equal((await recipeChanges(tart.id)).length, 1);
  });

  it('logs a deletion and keeps the log readable afterwards', async () => {
    const tart = await createTart();
    await api.delete(`/api/v1/recipes/${tart.id}`).expect(204);

    const history = await recipeChanges(tart.id);
    assert.deepEqual(history.map((entry) => entry.action), ['deleted', 'created']);
    assert.equal(byField(history[0]).foodCost[0], 13.3);
  });
});

describe('change feed', () => {
  it('lists recent changes across products and recipes, newest first', async () => {
    const tart = await createTart();
    await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);

    const res = await api.get('/api/v1/changes').expect(200);
    assert.deepEqual(
      res.body.items.map((entry) => `${entry.entityType}:${entry.entityName}:${entry.action}`),
      [
        'recipe:Shortcrust tart base:updated',
        'product:Butter 82%:updated',
        `recipe:Shortcrust tart base:created`,
        'product:Eggs L:created',
        'product:Wheat flour:created',
        'product:Butter 82%:created',
      ],
    );
    assert.equal(res.body.nextBefore, null);
    assert.equal(res.body.items[0].entityId, tart.id);
  });

  it('filters by entity type and pages with nextBefore', async () => {
    await createTart();

    const first = await api.get('/api/v1/changes').query({ entityType: 'product', limit: 2 }).expect(200);
    assert.deepEqual(first.body.items.map((entry) => entry.entityName), ['Eggs L', 'Wheat flour']);
    assert.equal(first.body.nextBefore, first.body.items[1].id);

    const second = await api.get('/api/v1/changes').query({ entityType: 'product', limit: 2, before: first.body.nextBefore }).expect(200);
    assert.deepEqual(second.body.items.map((entry) => entry.entityName), ['Butter 82%']);
    assert.equal(second.body.nextBefore, null);
  });

  it('validates the query', async () => {
    const res = await api.get('/api/v1/changes').query({ entityType: 'user', limit: 0 }).expect(400);
    assert.deepEqual(res.body.error.details.issues.map((issue) => issue.path).sort(), ['query.entityType', 'query.limit']);
  });
});
