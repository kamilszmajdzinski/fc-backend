import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createProduct, db, resetDatabase, sampleProducts, setupApi } from './helpers.js';

let api;
before(async () => {
  api = await setupApi();
});
beforeEach(resetDatabase);
after(() => db.destroy());

describe('products API', () => {
  it('creates a product and derives the price per kg', async () => {
    const res = await api.post('/api/v1/products').send(sampleProducts.butter).expect(201);

    assert.match(res.headers.location, /\/api\/v1\/products\/\d+$/);
    assert.equal(res.body.name, 'Butter 82%');
    assert.equal(res.body.pricePerPackage, 8);
    assert.equal(res.body.pricePerUnit, 40);
    assert.equal(res.body.pricingUnit, 'kg');
    assert.equal(res.body.inventoryQuantity, 1000);
    assert.equal(res.body.description, null);
    assert.ok(res.body.createdAt.endsWith('Z'));
  });

  it('derives the price per package from the price per unit', async () => {
    const { pricePerPackage, ...eggs } = sampleProducts.eggs;
    const product = await createProduct(api, { ...eggs, pricePerUnit: 1.2 });

    assert.equal(product.pricePerPackage, 12);
    assert.equal(product.pricingUnit, 'piece');
    assert.equal(product.inventoryQuantity, 0);
  });

  it('lists products and searches by name or manufacturer', async () => {
    await createProduct(api, sampleProducts.butter);
    await createProduct(api, sampleProducts.flour);

    const all = await api.get('/api/v1/products').expect(200);
    assert.deepEqual(all.body.items.map((p) => p.name), ['Butter 82%', 'Wheat flour']);

    const byName = await api.get('/api/v1/products?search=BUTT').expect(200);
    assert.deepEqual(byName.body.items.map((p) => p.name), ['Butter 82%']);

    const byManufacturer = await api.get('/api/v1/products?search=mill').expect(200);
    assert.deepEqual(byManufacturer.body.items.map((p) => p.name), ['Wheat flour']);
  });

  it('searches case-insensitively with Polish letters', async () => {
    await createProduct(api, { ...sampleProducts.butter, name: 'Śmietanka 36%', manufacturer: 'Łaciate' });
    await createProduct(api, { ...sampleProducts.flour, name: 'Żelatyna w proszku' });

    for (const search of ['śmietanka', 'ŚMIETANKA', 'łaciate']) {
      const res = await api.get('/api/v1/products').query({ search }).expect(200);
      assert.deepEqual(res.body.items.map((p) => p.name), ['Śmietanka 36%'], `search "${search}"`);
    }
    const gelatin = await api.get('/api/v1/products').query({ search: 'żelatyna' }).expect(200);
    assert.deepEqual(gelatin.body.items.map((p) => p.name), ['Żelatyna w proszku']);
  });

  it('returns a product by id and 404 for an unknown one', async () => {
    const butter = await createProduct(api, sampleProducts.butter);

    const res = await api.get(`/api/v1/products/${butter.id}`).expect(200);
    assert.equal(res.body.id, butter.id);

    const missing = await api.get('/api/v1/products/9999').expect(404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });

  it('rejects invalid input with field paths', async () => {
    const res = await api
      .post('/api/v1/products')
      .send({ name: '', packageSize: -1, packageUnit: 'cup', pricePerPackage: 5 })
      .expect(400);

    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const paths = res.body.error.details.issues.map((issue) => issue.path);
    assert.deepEqual(paths.sort(), ['body.name', 'body.packageSize', 'body.packageUnit']);
  });

  it('requires one of the two prices', async () => {
    const { pricePerPackage, ...withoutPrice } = sampleProducts.butter;
    const res = await api.post('/api/v1/products').send(withoutPrice).expect(400);
    assert.equal(res.body.error.details.issues[0].path, 'body.pricePerPackage');
  });

  it('rejects malformed JSON', async () => {
    const res = await api
      .post('/api/v1/products')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('PUT replaces the whole product', async () => {
    const butter = await createProduct(api, { ...sampleProducts.butter, description: 'Unsalted' });

    const res = await api
      .put(`/api/v1/products/${butter.id}`)
      .send({ name: 'Butter 84%', packageSize: 250, packageUnit: 'g', pricePerPackage: 11 })
      .expect(200);

    assert.equal(res.body.product.name, 'Butter 84%');
    assert.equal(res.body.product.description, null);
    assert.equal(res.body.product.manufacturer, null);
    assert.equal(res.body.product.pricePerUnit, 44);
    assert.equal(res.body.product.inventoryQuantity, 0);
    assert.deepEqual(res.body.recalculatedRecipes, []);
  });

  it('PATCH with only pricePerUnit updates the price per package', async () => {
    const butter = await createProduct(api, sampleProducts.butter);

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerUnit: 50 }).expect(200);

    assert.equal(res.body.product.pricePerUnit, 50);
    assert.equal(res.body.product.pricePerPackage, 10);
    assert.equal(res.body.product.name, 'Butter 82%');
  });

  it('PATCH of the package size keeps the package price and recalculates the price per unit', async () => {
    const butter = await createProduct(api, sampleProducts.butter);

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ packageSize: 250 }).expect(200);

    assert.equal(res.body.product.pricePerPackage, 8);
    assert.equal(res.body.product.pricePerUnit, 32);
  });

  it('PATCH can update inventory only', async () => {
    const butter = await createProduct(api, sampleProducts.butter);

    const res = await api.patch(`/api/v1/products/${butter.id}`).send({ inventoryQuantity: 400 }).expect(200);

    assert.equal(res.body.product.inventoryQuantity, 400);
    assert.equal(res.body.product.pricePerPackage, 8);
  });

  it('deletes an unused product', async () => {
    const butter = await createProduct(api, sampleProducts.butter);

    await api.delete(`/api/v1/products/${butter.id}`).expect(204);
    await api.get(`/api/v1/products/${butter.id}`).expect(404);
    await api.delete(`/api/v1/products/${butter.id}`).expect(404);
  });

  it('rejects a non-numeric id', async () => {
    const res = await api.get('/api/v1/products/abc').expect(400);
    assert.equal(res.body.error.details.issues[0].path, 'params.id');
  });
});
