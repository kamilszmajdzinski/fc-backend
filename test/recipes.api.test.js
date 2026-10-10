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
function tartBase(overrides = {}) {
  return {
    name: 'Shortcrust tart base',
    description: 'Sweet shortcrust',
    portions: 10,
    ingredients: [
      { productId: butter.id, quantity: 250, unit: 'g' },
      { productId: flour.id, quantity: 300, unit: 'g' },
      { productId: eggs.id, quantity: 2, unit: 'piece' },
    ],
    steps: ['Rub butter into flour', 'Add eggs', 'Chill for 1 hour'],
    ...overrides,
  };
}

async function createRecipe(data) {
  const res = await api.post('/api/v1/recipes').send(data).expect(201);
  return res.body;
}

describe('recipes API', () => {
  it('calculates ingredient costs, food cost and cost per portion', async () => {
    const res = await api.post('/api/v1/recipes').send(tartBase()).expect(201);
    const recipe = res.body;

    assert.match(res.headers.location, /\/api\/v1\/recipes\/\d+$/);
    assert.equal(recipe.foodCost, 13.3);
    assert.equal(recipe.costPerPortion, 1.33);
    assert.deepEqual(
      recipe.ingredients.map(({ productName, unitPrice, cost }) => ({ productName, unitPrice, cost })),
      [
        { productName: 'Butter 82%', unitPrice: 0.04, cost: 10 },
        { productName: 'Wheat flour', unitPrice: 0.003, cost: 0.9 },
        { productName: 'Eggs L', unitPrice: 1.2, cost: 2.4 },
      ],
    );
    assert.deepEqual(recipe.steps, ['Rub butter into flour', 'Add eggs', 'Chill for 1 hour']);

    const fetched = await api.get(`/api/v1/recipes/${recipe.id}`).expect(200);
    assert.deepEqual(fetched.body, recipe);
  });

  it('stores an optional sell price', async () => {
    const withoutPrice = await createRecipe(tartBase());
    assert.equal(withoutPrice.sellPrice, null);

    const tart = await createRecipe(tartBase({ name: 'Priced tart', sellPrice: 60 }));
    assert.equal(tart.sellPrice, 60);
    const list = await api.get('/api/v1/recipes?search=priced').expect(200);
    assert.equal(list.body.items[0].sellPrice, 60);

    const patched = await api.patch(`/api/v1/recipes/${tart.id}`).send({ sellPrice: 65.5 }).expect(200);
    assert.equal(patched.body.sellPrice, 65.5);
    const renamed = await api.patch(`/api/v1/recipes/${tart.id}`).send({ name: 'Priced tart 2' }).expect(200);
    assert.equal(renamed.body.sellPrice, 65.5, 'PATCH without sellPrice keeps it');
    const cleared = await api.patch(`/api/v1/recipes/${tart.id}`).send({ sellPrice: null }).expect(200);
    assert.equal(cleared.body.sellPrice, null);

    await api.patch(`/api/v1/recipes/${tart.id}`).send({ sellPrice: 70 }).expect(200);
    const replaced = await api.put(`/api/v1/recipes/${tart.id}`).send(tartBase({ name: 'Priced tart' })).expect(200);
    assert.equal(replaced.body.sellPrice, null, 'PUT without sellPrice clears it');
  });

  it('rejects a negative sell price', async () => {
    const res = await api.post('/api/v1/recipes').send(tartBase({ sellPrice: -1 })).expect(400);
    assert.equal(res.body.error.details.issues[0].path, 'body.sellPrice');
  });

  it('creates a new product inline while creating a recipe', async () => {
    const recipe = await createRecipe(
      tartBase({
        ingredients: [
          { productId: butter.id, quantity: 250, unit: 'g' },
          { product: { name: 'Caster sugar', packageSize: 1, packageUnit: 'kg', pricePerPackage: 4.5 }, quantity: 100, unit: 'g' },
        ],
      }),
    );

    assert.equal(recipe.ingredients[1].productName, 'Caster sugar');
    assert.equal(recipe.ingredients[1].cost, 0.45);
    assert.equal(recipe.foodCost, 10.45);

    const products = await api.get('/api/v1/products?search=sugar').expect(200);
    assert.equal(products.body.items.length, 1);
    assert.equal(products.body.items[0].id, recipe.ingredients[1].productId);
  });

  it('recalculates every recipe that uses a product when its price changes', async () => {
    const tart = await createRecipe(tartBase());
    const butterOnly = await createRecipe({ name: 'Brown butter', portions: 4, ingredients: [{ productId: butter.id, quantity: 100, unit: 'g' }] });
    const eggWash = await createRecipe({ name: 'Egg wash', portions: 20, ingredients: [{ productId: eggs.id, quantity: 1, unit: 'piece' }] });

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 10 }).expect(200);

    assert.equal(res.body.product.pricePerUnit, 50);
    assert.deepEqual(res.body.recalculatedRecipes, [
      { id: butterOnly.id, name: 'Brown butter', previousFoodCost: 4, foodCost: 5 },
      { id: tart.id, name: 'Shortcrust tart base', previousFoodCost: 13.3, foodCost: 15.8 },
    ]);

    const updatedTart = await api.get(`/api/v1/recipes/${tart.id}`).expect(200);
    assert.equal(updatedTart.body.foodCost, 15.8);
    assert.equal(updatedTart.body.costPerPortion, 1.58);
    assert.equal(updatedTart.body.ingredients[0].unitPrice, 0.05);
    assert.equal(updatedTart.body.ingredients[0].cost, 12.5);

    const untouched = await api.get(`/api/v1/recipes/${eggWash.id}`).expect(200);
    assert.equal(untouched.body.foodCost, 1.2);
  });

  it('recalculates recipes after a PUT on the product as well', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api
      .put(`/api/v1/products/${flour.id}`)
      .send({ ...sampleProducts.flour, pricePerPackage: 5 })
      .expect(200);

    assert.deepEqual(res.body.recalculatedRecipes, [
      { id: tart.id, name: 'Shortcrust tart base', previousFoodCost: 13.3, foodCost: 13.9 },
    ]);
  });

  it('does not recalculate when a change does not affect the price', async () => {
    await createRecipe(tartBase());

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 82% (unsalted)', inventoryQuantity: 0 }).expect(200);

    assert.deepEqual(res.body.recalculatedRecipes, []);
    const recipes = await api.get('/api/v1/recipes').expect(200);
    assert.equal(recipes.body.items[0].foodCost, 13.3);
  });

  it('shows the new product name in recipes after a rename', async () => {
    const tart = await createRecipe(tartBase());
    await api.patch(`/api/v1/products/${butter.id}`).send({ name: 'Butter 84%' }).expect(200);

    const res = await api.get(`/api/v1/recipes/${tart.id}`).expect(200);
    assert.equal(res.body.ingredients[0].productName, 'Butter 84%');
  });

  it('allows a product unit change within the same group without changing costs', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ packageSize: 0.2, packageUnit: 'kg' }).expect(200);

    assert.equal(res.body.recalculatedRecipes[0].foodCost, 13.3);
    const updated = await api.get(`/api/v1/recipes/${tart.id}`).expect(200);
    assert.equal(updated.body.foodCost, 13.3);
  });

  it('blocks a product unit change that conflicts with recipes', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ packageSize: 1, packageUnit: 'piece' }).expect(409);

    assert.equal(res.body.error.code, 'UNIT_CONFLICT');
    assert.deepEqual(res.body.error.details.recipes, [{ id: tart.id, name: 'Shortcrust tart base' }]);
    const unchanged = await api.get(`/api/v1/products/${butter.id}`).expect(200);
    assert.equal(unchanged.body.packageUnit, 'g');
  });

  it('blocks deleting a product that a recipe uses and lists the recipes', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api.delete(`/api/v1/products/${butter.id}`).expect(409);

    assert.equal(res.body.error.code, 'PRODUCT_IN_USE');
    assert.deepEqual(res.body.error.details.recipes, [{ id: tart.id, name: 'Shortcrust tart base' }]);

    const usage = await api.get(`/api/v1/products/${butter.id}/recipes`).expect(200);
    assert.deepEqual(usage.body.items, [{ id: tart.id, name: 'Shortcrust tart base' }]);
  });

  it('allows deleting the product once the recipe is gone', async () => {
    const tart = await createRecipe(tartBase());

    await api.delete(`/api/v1/recipes/${tart.id}`).expect(204);
    await api.get(`/api/v1/recipes/${tart.id}`).expect(404);
    await api.delete(`/api/v1/products/${butter.id}`).expect(204);

    // The deleted recipe keeps its other lines for a restore; only the deleted product's line goes.
    const lines = await db('recipe_ingredients').where('recipe_id', tart.id).pluck('product_id');
    assert.deepEqual(lines.sort(), [flour.id, eggs.id].sort());
  });

  it('rejects a unit from a different group and saves nothing', async () => {
    const res = await api
      .post('/api/v1/recipes')
      .send(
        tartBase({
          ingredients: [
            { product: { name: 'Milk 3.2%', packageSize: 1, packageUnit: 'l', pricePerPackage: 4 }, quantity: 200, unit: 'ml' },
            { productId: butter.id, quantity: 100, unit: 'ml' },
          ],
        }),
      )
      .expect(400);

    assert.deepEqual(res.body.error.details.issues.map((issue) => issue.path), ['body.ingredients[1].unit']);
    assert.match(res.body.error.details.issues[0].message, /mg, g, kg/);

    const recipes = await api.get('/api/v1/recipes').expect(200);
    assert.equal(recipes.body.items.length, 0);
    const milk = await api.get('/api/v1/products?search=milk').expect(200);
    assert.equal(milk.body.items.length, 0, 'the inline product must be rolled back');
  });

  it('rejects an unknown productId', async () => {
    const res = await api
      .post('/api/v1/recipes')
      .send(tartBase({ ingredients: [{ productId: 9999, quantity: 1, unit: 'g' }] }))
      .expect(400);
    assert.equal(res.body.error.details.issues[0].path, 'body.ingredients[0].productId');
  });

  it('rejects an ingredient with both productId and product', async () => {
    const res = await api
      .post('/api/v1/recipes')
      .send(tartBase({ ingredients: [{ productId: butter.id, product: sampleProducts.flour, quantity: 1, unit: 'g' }] }))
      .expect(400);
    assert.equal(res.body.error.details.issues[0].path, 'body.ingredients[0].productId');
  });

  it('PATCH replaces only the lists that are sent', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api
      .patch(`/api/v1/recipes/${tart.id}`)
      .send({ ingredients: [{ productId: flour.id, quantity: 500, unit: 'g' }] })
      .expect(200);

    assert.equal(res.body.name, 'Shortcrust tart base');
    assert.equal(res.body.ingredients.length, 1);
    assert.equal(res.body.foodCost, 1.5);
    assert.equal(res.body.steps.length, 3);
  });

  it('PATCH of portions updates the cost per portion', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api.patch(`/api/v1/recipes/${tart.id}`).send({ portions: 4 }).expect(200);

    assert.equal(res.body.foodCost, 13.3);
    assert.equal(res.body.costPerPortion, 3.33);
  });

  it('PUT replaces the whole recipe', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api
      .put(`/api/v1/recipes/${tart.id}`)
      .send({ name: 'Plain base', portions: 2, ingredients: [{ productId: eggs.id, quantity: 3, unit: 'piece' }] })
      .expect(200);

    assert.equal(res.body.name, 'Plain base');
    assert.equal(res.body.description, null);
    assert.deepEqual(res.body.steps, []);
    assert.equal(res.body.foodCost, 3.6);
    assert.equal(res.body.costPerPortion, 1.8);
  });

  it('accepts the body of a GET back as a PUT', async () => {
    const tart = await createRecipe(tartBase());

    const res = await api.put(`/api/v1/recipes/${tart.id}`).send(tart).expect(200);

    assert.equal(res.body.foodCost, 13.3);
    assert.equal(res.body.ingredients.length, 3);
  });

  it('lists recipe summaries and searches by name', async () => {
    await createRecipe(tartBase());
    await createRecipe({ name: 'Egg wash', portions: 20, ingredients: [{ productId: eggs.id, quantity: 1, unit: 'piece' }] });

    const all = await api.get('/api/v1/recipes').expect(200);
    assert.deepEqual(
      all.body.items.map(({ name, foodCost, costPerPortion, ingredientCount }) => ({ name, foodCost, costPerPortion, ingredientCount })),
      [
        { name: 'Egg wash', foodCost: 1.2, costPerPortion: 0.06, ingredientCount: 1 },
        { name: 'Shortcrust tart base', foodCost: 13.3, costPerPortion: 1.33, ingredientCount: 3 },
      ],
    );

    const search = await api.get('/api/v1/recipes?search=tart').expect(200);
    assert.equal(search.body.items.length, 1);
  });

  it('searches recipe names with Polish letters', async () => {
    await createRecipe(tartBase({ name: 'Ślimaki cynamonowe' }));

    const res = await api.get('/api/v1/recipes').query({ search: 'ślimaki' }).expect(200);
    assert.deepEqual(res.body.items.map((r) => r.name), ['Ślimaki cynamonowe']);
  });

  it('returns 404 for an unknown recipe', async () => {
    await api.get('/api/v1/recipes/9999').expect(404);
    await api.patch('/api/v1/recipes/9999').send({ portions: 2 }).expect(404);
    await api.delete('/api/v1/recipes/9999').expect(404);
  });
});
