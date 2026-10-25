import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { importCatalog } from '../src/modules/catalog/catalog.import.js';
import { authAs, createProduct, db, resetDatabase, sampleProducts, setupApi, USER_B } from './helpers.js';

let api;

before(async () => {
  api = await setupApi();
});

after(() => db.destroy());

beforeEach(resetDatabase);

const recipe = (fields = {}) => ({ name: 'Tart', portions: 8, ...fields });

describe('product category', () => {
  it('is saved, returned and optional', async () => {
    const butter = await createProduct(api, { ...sampleProducts.butter, category: 'Tłuszcze' });
    assert.equal(butter.category, 'Tłuszcze');
    assert.equal((await api.get(`/api/v1/products/${butter.id}`).expect(200)).body.category, 'Tłuszcze');

    assert.equal((await createProduct(api, sampleProducts.flour)).category, null);
    assert.equal((await createProduct(api, { ...sampleProducts.eggs, category: '  ' })).category, null);
  });

  it('is kept by a PATCH without it and cleared with null', async () => {
    const butter = await createProduct(api, { ...sampleProducts.butter, category: 'Tłuszcze' });
    const patched = await api.patch(`/api/v1/products/${butter.id}`).send({ pricePerPackage: 9 }).expect(200);
    assert.equal(patched.body.product.category, 'Tłuszcze');

    const cleared = await api.patch(`/api/v1/products/${butter.id}`).send({ category: null }).expect(200);
    assert.equal(cleared.body.product.category, null);
  });

  it('takes the spelling of an existing category that differs only in letter case', async () => {
    assert.equal((await createProduct(api, { ...sampleProducts.butter, category: 'nabiał' })).category, 'Nabiał');
    await createProduct(api, { ...sampleProducts.flour, category: 'Moje mąki' });
    assert.equal((await createProduct(api, { ...sampleProducts.eggs, category: 'MOJE MĄKI' })).category, 'Moje mąki');
  });

  it('can be a category the user made up, which is then listed', async () => {
    await createProduct(api, { ...sampleProducts.butter, category: 'Tłuszcze' });
    await createProduct(api, { ...sampleProducts.flour, category: 'Mąki włoskie' });
    await createProduct(api, { ...sampleProducts.eggs, category: 'Mąki włoskie' });

    const { items } = (await api.get('/api/v1/products/categories').expect(200)).body;
    assert.deepEqual(items.find((item) => item.name === 'Mąki włoskie'), { name: 'Mąki włoskie', count: 2, isDefault: false });
    assert.deepEqual(items.find((item) => item.name === 'Tłuszcze'), { name: 'Tłuszcze', count: 1, isDefault: true });
    assert.deepEqual(items.find((item) => item.name === 'Jaja'), { name: 'Jaja', count: 0, isDefault: true });
    const names = items.map((item) => item.name);
    assert.deepEqual(names, names.toSorted((a, b) => a.localeCompare(b, 'pl')));
  });

  it('filters the product list', async () => {
    await createProduct(api, { ...sampleProducts.butter, category: 'Tłuszcze' });
    await createProduct(api, sampleProducts.flour);
    const { items } = (await api.get('/api/v1/products?category=tłuszcze').expect(200)).body;
    assert.deepEqual(items.map((item) => item.name), ['Butter 82%']);
  });

  it('is in the change log', async () => {
    const butter = await createProduct(api, sampleProducts.butter);
    await api.patch(`/api/v1/products/${butter.id}`).send({ category: 'Tłuszcze' }).expect(200);
    const { items } = (await api.get(`/api/v1/products/${butter.id}/changes`).expect(200)).body;
    assert.deepEqual(items[0].changes, [{ field: 'category', from: null, to: 'Tłuszcze' }]);
  });

  it("is not shared with other users", async () => {
    await createProduct(api, { ...sampleProducts.butter, category: 'Tajne' });
    const bob = await authAs(USER_B);
    const { items } = (await bob.get('/api/v1/products/categories').expect(200)).body;
    assert.equal(items.some((item) => item.name === 'Tajne'), false);
  });
});

describe('recipe category', () => {
  it('is saved, patched and listed', async () => {
    const created = (await api.post('/api/v1/recipes').send(recipe({ category: 'tarty' })).expect(201)).body;
    assert.equal(created.category, 'Tarty');

    const patched = (await api.patch(`/api/v1/recipes/${created.id}`).send({ portions: 10 }).expect(200)).body;
    assert.equal(patched.category, 'Tarty');

    const [summary] = (await api.get('/api/v1/recipes?category=Tarty').expect(200)).body.items;
    assert.equal(summary.category, 'Tarty');
    assert.deepEqual((await api.get('/api/v1/recipes?category=Torty').expect(200)).body.items, []);
  });

  it("doesn't count deleted recipes", async () => {
    await api.post('/api/v1/recipes').send(recipe({ category: 'Na wesela' })).expect(201);
    const deleted = (await api.post('/api/v1/recipes').send(recipe({ name: 'Old', category: 'Na wesela' })).expect(201)).body;
    await api.delete(`/api/v1/recipes/${deleted.id}`).expect(204);

    const { items } = (await api.get('/api/v1/recipes/categories').expect(200)).body;
    assert.deepEqual(items.find((item) => item.name === 'Na wesela'), { name: 'Na wesela', count: 1, isDefault: false });
    assert.equal(items.find((item) => item.name === 'Torty').isDefault, true);
  });
});

describe('product suggestion', () => {
  // Frisco category names, which the suggestion maps onto the built-in categories.
  const categories = [
    { id: '1', parentId: null, parentPath: '1', depth: 0, name: { pl: 'Spiżarnia' } },
    { id: '2', parentId: '1', parentPath: '2,1', depth: 1, name: { pl: 'Sypkie i produkty zbożowe' } },
    { id: '3', parentId: '2', parentPath: '3,2,1', depth: 2, name: { pl: 'Cukier i słodziki' } },
    { id: '4', parentId: null, parentPath: '4', depth: 0, name: { pl: 'Słodycze, przekąski, bakalie' } },
    { id: '5', parentId: null, parentPath: '5', depth: 0, name: { pl: 'Alkohole' } },
    { id: '6', parentId: null, parentPath: '6', depth: 0, name: { pl: 'Warzywa i owoce' } },
    { id: '7', parentId: '6', parentPath: '7,6', depth: 1, name: { pl: 'Cytrusy' } },
    { id: '8', parentId: null, parentPath: '8', depth: 0, name: { pl: 'Kosmetyki i higiena osobista' } },
  ];
  const product = (id, name, categoryPath, brand) => ({
    id,
    name: { pl: name },
    brand,
    unitOfMeasure: 'Kilogram',
    grammage: 1,
    price: { price: 5 },
    categories: [{ parentPath: categoryPath }],
  });

  before(async () => {
    await importCatalog(db, {
      categories,
      products: [
        product('1', 'Mąka pszenna tortowa', '2,1', 'LUBELLA'),
        product('2', 'Mąka pszenna luksusowa', '2,1', 'LUBELLA'),
        product('3', 'Mąka orkiszowa', '2,1', 'OSM MŁYN'),
        product('4', 'Cukier puder', '3,2,1'),
        product('5', 'Cukier trzcinowy', '3,2,1'),
        product('6', 'Cukierki owocowe', '4'),
        product('7', 'Cukierki miętowe', '4'),
        product('8', 'Cukierki krówki', '4'),
        product('9', 'Cytryna', '7,6', 'SADY POLSKIE'),
        product('14', 'Cytryna bio', '7,6', 'FRISCO FRESH'),
        product('10', 'Cytryna wódka', '5', 'WÓDKA CO'),
        product('11', 'Cytryna likier', '5', 'WÓDKA CO'),
        product('12', 'Cytryna nalewka', '5', 'WÓDKA CO'),
        product('13', 'Krem do rąk', '8', 'NIVEA'),
      ],
    });
  });

  const suggest = async (name) => (await api.get(`/api/v1/products/suggestion?name=${encodeURIComponent(name)}`).expect(200)).body;

  it('maps catalog products with a similar name onto a built-in category and their most common brand', async () => {
    assert.deepEqual(await suggest('Mąka pszenna Szymanowska'), {
      name: 'Mąka pszenna Szymanowska',
      category: { value: 'Mąka i produkty zbożowe', source: 'catalog', confidence: 1, alternatives: [] },
      // Brands in capitals are shown in normal case, except short words such as "OSM".
      manufacturer: { value: 'Lubella', source: 'catalog', confidence: 1, alternatives: [] },
    });
    assert.deepEqual((await suggest('mąka')).manufacturer, { value: 'Lubella', source: 'catalog', confidence: 0.67, alternatives: ['OSM Młyn'] });
    assert.equal((await suggest('maka')).category.value, 'Mąka i produkty zbożowe'); // without Polish letters
    // The more specific category wins over its parent ("Sypkie i produkty zbożowe").
    assert.equal((await suggest('cukier puder')).category.value, 'Cukier i słodziki');
  });

  it('prefers products that have the whole word', async () => {
    assert.equal((await suggest('Cukier')).category.value, 'Cukier i słodziki');
    assert.equal((await suggest('Cukierki')).category.value, 'Słodycze i przekąski');
  });

  it("counts drinks and alcohol for less, and takes brands from the suggested category only, never the shop's own", async () => {
    const lemon = await suggest('Cytryna');
    assert.equal(lemon.category.value, 'Owoce');
    assert.deepEqual(lemon.category.alternatives, ['Napoje i alkohole']);
    assert.deepEqual(lemon.manufacturer, { value: 'Sady Polskie', source: 'catalog', confidence: 1, alternatives: [] });
  });

  it('has no manufacturer when the matching products have no brand', async () => {
    assert.equal((await suggest('Cukier puder')).manufacturer, null);
  });

  it('returns nothing when nothing fits', async () => {
    assert.deepEqual(await suggest('Krem do rąk'), { name: 'Krem do rąk', category: null, manufacturer: null });
  });

  it("prefers what the user chose for a product with a similar name", async () => {
    await createProduct(api, { ...sampleProducts.flour, name: 'Mąka pszenna 00', manufacturer: 'Caputo', category: 'Mąki włoskie' });

    // Same first word: their category; but not their manufacturer, which may differ per flour.
    const spelt = await suggest('Mąka orkiszowa');
    assert.deepEqual(spelt.category, { value: 'Mąki włoskie', source: 'own', confidence: 1, alternatives: ['Mąka i produkty zbożowe'] });
    assert.equal(spelt.manufacturer.source, 'catalog');

    // Same name: both.
    const same = await suggest('mąka pszenna 00');
    assert.deepEqual(same.manufacturer, { value: 'Caputo', source: 'own', confidence: 1, alternatives: ['Lubella'] });
  });

  it('needs at least 2 characters', async () => {
    await api.get('/api/v1/products/suggestion?name=m').expect(400);
  });
});
