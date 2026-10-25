import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { importCatalog } from '../src/modules/catalog/catalog.import.js';
import { anonymous, db, setupApi } from './helpers.js';

// A tiny feed shaped like the Frisco one: dairy > milk / cheese, and a BIO tree that mirrors it.
function category(id, parentPath, name, productCount) {
  const ids = parentPath.split(',');
  return { id, parentId: ids[1], parentPath, depth: ids.length - 1, name: { pl: name, en: `${name} (en)` }, productCount };
}

function product(id, { name, categories, price, ...rest }) {
  return {
    id,
    ean: `590${id}`,
    name: { pl: name, en: `${name} (en)` },
    unitOfMeasure: 'Kilogram',
    grammage: 1,
    packSize: 1,
    isAvailable: true,
    price: price === null ? {} : { price, ...rest.priceExtra },
    categories: categories.map((parentPath) => ({ categoryId: parentPath.split(',')[0], parentPath })),
    primaryCategory: { categoryId: categories[0].split(',')[0], parentPath: categories[0] },
    ...rest,
  };
}

const feed = {
  generatedAt: '2026-10-25T01:21:19+02:00',
  categories: [
    category('1', '1', 'Nabiał', 3),
    category('2', '2,1', 'Mleko', 2),
    category('3', '3,1', 'Sery', 1),
    category('100', '100', 'BIO', 1),
    category('101', '101,100', 'Mleko', 1),
    category('9', '9', 'Napoje', 1),
  ],
  products: [
    product('10', { name: 'Mleko 3,2%', brand: 'Łaciate', producer: 'Mlekpol', unitOfMeasure: 'Litre', grammage: 1, price: 4.2, categories: ['2,1'] }),
    product('11', {
      name: 'Mleko BIO',
      brand: 'Eko',
      unitOfMeasure: 'Litre',
      grammage: 0.5,
      price: 5,
      priceExtra: { priceBeforeDiscount: 6.25, priceAfterPromotion: 4.5 },
      categories: ['2,1', '101,100'],
    }),
    product('12', { name: 'Ser gouda', brand: 'Mlekovita', grammage: 0.25, price: 9.99, categories: ['3,1'], description: 'Ser żółty', rating: { rating: 4.5, votes: 12 } }),
    product('13', { name: 'Woda 12 x 0,5 l', unitOfMeasure: 'Litre', grammage: 6, packSize: 12, price: null, categories: ['9'], isAvailable: undefined }),
  ],
};

// The same feed with one kitchen product more, under the shop's own brand.
const kitchenFeed = {
  ...feed,
  categories: [...feed.categories, category('15', '15,1', 'Masło i margaryny', 1)],
  products: [...feed.products, product('14', { name: 'Masło', brand: 'FRISCO FRESH', price: 7, categories: ['15,1'] })],
};

let api;
before(async () => {
  api = await setupApi();
});
beforeEach(() => importCatalog(db, feed));
after(() => db.destroy());

const ids = (res) => res.body.items.map((item) => item.id);

describe('catalog import', () => {
  it('maps prices, units and the price per kg or l', async () => {
    const res = await api.get('/api/v1/catalog/products/11').expect(200);

    assert.equal(res.body.name, 'Mleko BIO');
    assert.equal(res.body.packageSize, 0.5);
    assert.equal(res.body.packageUnit, 'l');
    assert.equal(res.body.pricingUnit, 'l');
    // Catalog prices are shown as rounded "average market price" estimates, not the exact scraped
    // shelf price (roundMarketPrice): 6.25 rounds to the nearest 0.50 here.
    assert.equal(res.body.price, 5);
    assert.equal(res.body.regularPrice, 6.5);
    assert.equal(res.body.promotionPrice, 4.5);
    assert.equal(res.body.discountPercent, 20);
    assert.equal(res.body.pricePerUnit, 10);
    assert.equal(res.body.isAvailable, true);
    assert.deepEqual(res.body.primaryCategory, { id: '2', name: 'Mleko' });
    assert.deepEqual(res.body.primaryCategoryPath, [
      { id: '1', name: 'Nabiał' },
      { id: '2', name: 'Mleko' },
    ]);
  });

  it('keeps products without a price or availability', async () => {
    const res = await api.get('/api/v1/catalog/products/13').expect(200);
    assert.equal(res.body.price, null);
    assert.equal(res.body.pricePerUnit, null);
    assert.equal(res.body.isAvailable, false);
    assert.equal(res.body.packCount, 12);
  });

  it('replaces the previous catalog and reports the import', async () => {
    await importCatalog(db, { ...feed, generatedAt: '2026-10-26T01:00:00+02:00', products: feed.products.slice(0, 1) });

    const list = await api.get('/api/v1/catalog/products').expect(200);
    assert.deepEqual(ids(list), ['10']);
    await api.get('/api/v1/catalog/products/12').expect(404);

    const status = await api.get('/api/v1/catalog').expect(200);
    assert.equal(status.body.feedGeneratedAt, '2026-10-26T01:00:00+02:00');
    assert.equal(status.body.productCount, 1);
    assert.equal(status.body.categoryCount, 6);
    assert.ok(status.body.importedAt.endsWith('Z'));
  });

  it('rejects a feed without products', async () => {
    await assert.rejects(importCatalog(db, { categories: [] }), /no categories or products/);
  });
});

describe('catalog products API', () => {
  it('needs a login', async () => {
    await anonymous().get('/api/v1/catalog/products').expect(401);
  });

  it('lists products sorted by name with the total count', async () => {
    const res = await api.get('/api/v1/catalog/products').query({ limit: 2 }).expect(200);
    assert.deepEqual(ids(res), ['10', '11']);
    assert.equal(res.body.total, 4);
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.offset, 0);

    const next = await api.get('/api/v1/catalog/products').query({ limit: 2, offset: 2 }).expect(200);
    assert.deepEqual(ids(next), ['12', '13']);
  });

  it('filters by a category and its whole subtree', async () => {
    const dairy = await api.get('/api/v1/catalog/products').query({ categoryId: '1' }).expect(200);
    assert.deepEqual(ids(dairy), ['10', '11', '12']);

    const bio = await api.get('/api/v1/catalog/products').query({ categoryId: '100' }).expect(200);
    assert.deepEqual(ids(bio), ['11']);

    const several = await api.get('/api/v1/catalog/products').query({ categoryId: '3,9' }).expect(200);
    assert.deepEqual(ids(several), ['12', '13']);
  });

  it('searches name, brand and producer case-insensitively with Polish letters', async () => {
    for (const search of ['ŁACIATE', 'mlekpol', 'gouda']) {
      const res = await api.get('/api/v1/catalog/products').query({ search }).expect(200);
      assert.equal(res.body.total, 1, `search "${search}"`);
    }
  });

  it('filters by brand, ean, unit, availability, sale and price', async () => {
    const cases = [
      [{ brand: 'eko' }, ['11']],
      [{ ean: '59012' }, ['12']],
      [{ unit: 'kg' }, ['12']],
      [{ available: 'false' }, ['13']],
      [{ onSale: 'true' }, ['11']],
      [{ onSale: 'false' }, ['10', '12', '13']],
      [{ minPrice: 5, maxPrice: 9.99 }, ['11', '12']],
      [{ categoryId: '1', maxPrice: 5 }, ['10', '11']],
    ];
    for (const [query, expected] of cases) {
      const res = await api.get('/api/v1/catalog/products').query(query).expect(200);
      assert.deepEqual(ids(res), expected, JSON.stringify(query));
    }
  });

  it('sorts by price per unit both ways, products without a price last', async () => {
    const asc = await api.get('/api/v1/catalog/products').query({ sort: 'pricePerUnit' }).expect(200);
    assert.deepEqual(ids(asc), ['10', '11', '12', '13']);

    const desc = await api.get('/api/v1/catalog/products').query({ sort: '-pricePerUnit' }).expect(200);
    assert.deepEqual(ids(desc), ['12', '11', '10', '13']);

    const discount = await api.get('/api/v1/catalog/products').query({ sort: '-discountPercent', limit: 1 }).expect(200);
    assert.deepEqual(ids(discount), ['11']);
  });

  it('returns product details', async () => {
    const res = await api.get('/api/v1/catalog/products/12').expect(200);
    assert.equal(res.body.description, 'Ser żółty');
    assert.equal(res.body.rating, 4.5);
    assert.equal(res.body.ratingVotes, 12);
    // Rounded to a market-price estimate (roundMarketPrice): 39.96 -> nearest 1.
    assert.equal(res.body.pricePerUnit, 40);
  });

  it('drafts a product of the user\'s from a catalog product, for the "add product" form', async () => {
    // 0.25 kg reads better as 250 g; the test feed's "Sery" isn't a mapped category.
    const cheese = (await api.get('/api/v1/catalog/products/12').expect(200)).body;
    // The price is rounded to a market-price estimate (roundMarketPrice): 9.99 -> nearest 0.50.
    assert.deepEqual(cheese.productDraft, {
      name: 'Ser gouda',
      manufacturer: 'Mlekovita',
      category: null,
      packageSize: 250,
      packageUnit: 'g',
      pricePerPackage: 10,
    });

    // "Napoje" maps onto a built-in category; no price and no brand stay null.
    const water = (await api.get('/api/v1/catalog/products/13').expect(200)).body;
    assert.deepEqual(water.productDraft, {
      name: 'Woda 12 x 0,5 l',
      manufacturer: null,
      category: 'Napoje i alkohole',
      packageSize: 6,
      packageUnit: 'l',
      pricePerPackage: null,
    });
  });

  it('lists only kitchen products, or one kitchen category, and hides the shop\'s own brands', async () => {
    await importCatalog(db, kitchenFeed);
    const kitchen = await api.get('/api/v1/catalog/products').query({ kitchen: 'true' }).expect(200);
    assert.deepEqual(ids(kitchen).sort(), ['13', '14'], 'only "Napoje" and "Masło i margaryny" are mapped in this feed');
    const butter = await api.get('/api/v1/catalog/products').query({ kitchenCategory: 'Tłuszcze' }).expect(200);
    assert.deepEqual(ids(butter), ['14']);
    assert.equal(butter.body.items[0].kitchenCategory, 'Tłuszcze');
    assert.equal(butter.body.items[0].brand, null);
    assert.equal((await api.get('/api/v1/catalog/products/14').expect(200)).body.productDraft.manufacturer, null);
  });

  it('lists the kitchen categories with product counts, in the built-in order', async () => {
    await importCatalog(db, kitchenFeed);
    const res = await api.get('/api/v1/catalog/kitchen-categories').expect(200);
    assert.deepEqual(res.body.items, [
      { name: 'Tłuszcze', productCount: 1 },
      { name: 'Napoje i alkohole', productCount: 1 },
    ]);
    const available = await api.get('/api/v1/catalog/kitchen-categories').query({ available: 'true' }).expect(200);
    assert.deepEqual(available.body.items, [{ name: 'Tłuszcze', productCount: 1 }], 'the water is not available');
  });

  it('rejects invalid filters', async () => {
    const res = await api
      .get('/api/v1/catalog/products')
      .query({ sort: 'cheapest', categoryId: 'dairy', available: 'yes', minPrice: 10, maxPrice: 5, limit: 500 })
      .expect(400);
    const paths = res.body.error.details.issues.map((issue) => issue.path).sort();
    assert.deepEqual(paths, ['query.available', 'query.categoryId', 'query.limit', 'query.sort']);

    const range = await api.get('/api/v1/catalog/products').query({ minPrice: 10, maxPrice: 5 }).expect(400);
    assert.deepEqual(range.body.error.details.issues.map((issue) => issue.path), ['query.minPrice']);

    await api.get('/api/v1/catalog/products/abc').expect(400);
    await api.get('/api/v1/catalog/products/999').expect(404);
  });
});

describe('catalog categories API', () => {
  it('lists top-level categories and the children of one', async () => {
    const top = await api.get('/api/v1/catalog/categories').expect(200);
    assert.deepEqual(top.body.items.map((c) => c.name), ['BIO', 'Nabiał', 'Napoje']);
    const dairy = top.body.items.find((c) => c.id === '1');
    assert.equal(dairy.hasChildren, true);
    assert.equal(dairy.productCount, 3);

    const children = await api.get('/api/v1/catalog/categories').query({ parentId: '1' }).expect(200);
    assert.deepEqual(children.body.items.map((c) => c.id), ['2', '3']);
    assert.equal(children.body.items[0].hasChildren, false);
  });

  it('searches categories and shows where each one is', async () => {
    const res = await api.get('/api/v1/catalog/categories').query({ search: 'mleko' }).expect(200);
    assert.deepEqual(
      res.body.items.map((c) => c.path.map((p) => p.name).join(' > ')),
      ['BIO > Mleko', 'Nabiał > Mleko'],
    );
  });

  it('returns a category with its path and children', async () => {
    const res = await api.get('/api/v1/catalog/categories/1').expect(200);
    assert.deepEqual(res.body.path, [{ id: '1', name: 'Nabiał' }]);
    assert.deepEqual(res.body.children.map((c) => c.name), ['Mleko', 'Sery']);

    await api.get('/api/v1/catalog/categories/999').expect(404);
  });
});
