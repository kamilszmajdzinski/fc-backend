import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';
import { after, before, beforeEach, describe, it } from 'node:test';
import { anonymous, authAs, createProduct, db, resetDatabase, sampleProducts, setupApi, signToken, USER_A, USER_B } from './helpers.js';

let alice;
let bob;
let butter;
let crumble;

before(async () => {
  alice = await setupApi();
  bob = await authAs(USER_B);
});
beforeEach(async () => {
  await resetDatabase();
  butter = await createProduct(alice, sampleProducts.butter);
  crumble = (
    await alice
      .post('/api/v1/recipes')
      .send({ name: 'Crumble', portions: 4, yieldQuantity: 300, yieldUnit: 'g', ingredients: [{ productId: butter.id, quantity: 100, unit: 'g' }] })
      .expect(201)
  ).body;
});
after(() => db.destroy());

describe('logging in', () => {
  it('rejects API requests without a token', async () => {
    const res = await anonymous().get('/api/v1/products').expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('rejects tokens that are not valid', async () => {
    const { privateKey: otherKey } = await generateKeyPair('ES256');
    const cases = {
      'not a JWT': 'abc',
      'signed with another key': await signToken(USER_A, { key: otherKey }),
      'from another Supabase project': await signToken(USER_A, { issuer: 'https://other.supabase.co/auth/v1' }),
      'for another audience': await signToken(USER_A, { audience: 'anon' }),
      expired: await signToken(USER_A, { expiresIn: '-1m' }),
    };
    for (const [name, token] of Object.entries(cases)) {
      const res = await anonymous().get('/api/v1/products').set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 401, name);
    }
  });

  it('keeps /health public', async () => {
    await anonymous().get('/health').expect(200);
  });
});

describe('each user sees only their own data', () => {
  it('lists nothing of anyone else', async () => {
    assert.deepEqual((await bob.get('/api/v1/products').expect(200)).body.items, []);
    assert.deepEqual((await bob.get('/api/v1/recipes').expect(200)).body.items, []);
    assert.deepEqual((await bob.get('/api/v1/changes').expect(200)).body.items, []);
    assert.equal((await alice.get('/api/v1/products').expect(200)).body.items.length, 1);
  });

  it("reports another user's products and recipes as not found", async () => {
    const paths = [
      `/api/v1/products/${butter.id}`,
      `/api/v1/products/${butter.id}/recipes`,
      `/api/v1/products/${butter.id}/price-history`,
      `/api/v1/products/${butter.id}/changes`,
      `/api/v1/recipes/${crumble.id}`,
      `/api/v1/recipes/${crumble.id}/cost-history`,
      `/api/v1/recipes/${crumble.id}/changes`,
      `/api/v1/recipes/${crumble.id}/used-in`,
    ];
    for (const path of paths) {
      const res = await bob.get(path);
      assert.equal(res.status, 404, path);
    }
  });

  it("can't change, delete or restore another user's data", async () => {
    await bob.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 1 }).expect(404);
    await bob.put(`/api/v1/products/${butter.id}`).send(sampleProducts.flour).expect(404);
    await bob.delete(`/api/v1/products/${butter.id}`).expect(404);
    await bob.patch(`/api/v1/recipes/${crumble.id}`).send({ name: 'Mine now' }).expect(404);
    await bob.delete(`/api/v1/recipes/${crumble.id}`).expect(404);

    await alice.delete(`/api/v1/recipes/${crumble.id}`).expect(204);
    await bob.post(`/api/v1/recipes/${crumble.id}/restore`).expect(404);

    const product = (await alice.get(`/api/v1/products/${butter.id}`).expect(200)).body;
    assert.equal(product.pricePerPackage, sampleProducts.butter.pricePerPackage);
  });

  it("can't use another user's product or recipe as an ingredient", async () => {
    const res = await bob
      .post('/api/v1/recipes')
      .send({
        name: 'Stolen tart',
        portions: 1,
        ingredients: [
          { productId: butter.id, quantity: 10, unit: 'g' },
          { recipeId: crumble.id, quantity: 1, unit: 'portion' },
        ],
      })
      .expect(400);
    assert.deepEqual(
      res.body.error.details.issues.map((issue) => issue.path),
      ['body.ingredients[0].productId', 'body.ingredients[1].recipeId'],
    );
    // The same messages as for ids that don't exist, so nobody learns which ids are taken.
    assert.match(res.body.error.details.issues[0].message, /does not exist/);
    assert.match(res.body.error.details.issues[1].message, /does not exist/);
  });

  it("doesn't let a price change reach another user's recipes", async () => {
    const own = await createProduct(bob, sampleProducts.butter);
    await bob.patch(`/api/v1/products/${own.id}`).send({ pricePerPackage: 100 }).expect(200);

    const recipe = (await alice.get(`/api/v1/recipes/${crumble.id}`).expect(200)).body;
    assert.equal(recipe.foodCost, 4);
    const feed = (await alice.get('/api/v1/changes').expect(200)).body.items;
    assert.equal(feed.some((entry) => entry.entityType === 'product' && entry.entityId === own.id), false);
  });
});
