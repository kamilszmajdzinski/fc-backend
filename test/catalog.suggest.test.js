import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { importCatalog } from '../src/modules/catalog/catalog.import.js';
import { fold } from '../src/modules/catalog/catalog.suggest.js';
import { db, setupApi } from './helpers.js';

// Real category ids. All are food/kitchen categories and thus included, except COSMETICS, which
// documents the one kind of category catalog.suggest leaves out.
const FLOUR = '19458'; // Spiżarnia › Sypkie › Mąka
const SUGAR = '19479'; // Spiżarnia › Sypkie › Cukier i słodziki
const BAKING = '20000'; // Spiżarnia › Wypieki i desery
const EGGS = '19118'; // Nabiał › Jaja
const BUTTER = '19123'; // Nabiał › Masło i margaryny
const PASTA = '19380'; // Spiżarnia › Sypkie › Makaron (a savory staple, not just pastry)
const CANDY = '20378'; // Słodycze › Cukierki, lizaki i gumy
const COSMETICS = '21336'; // Kosmetyki i higiena osobista (the one excluded top level used here)

function category(id, name) {
  return { id, parentId: null, parentPath: id, depth: 0, name: { pl: name } };
}

function product(id, name, categoryId, { unit = 'Kilogram', grammage = 1, price, isAvailable = true, brand } = {}) {
  return {
    id,
    name: { pl: name },
    brand,
    unitOfMeasure: unit,
    grammage,
    isAvailable,
    price: { price },
    categories: [{ categoryId, parentPath: categoryId }],
  };
}

const feed = {
  generatedAt: '2026-10-25T01:00:00+02:00',
  categories: [FLOUR, SUGAR, BAKING, EGGS, BUTTER, PASTA, CANDY, COSMETICS].map((id) => category(id, id)),
  products: [
    product('f1', 'Mąka pszenna tortowa typ 450', FLOUR, { price: 3, brand: 'Lubella' }),
    product('f2', 'Mąka pszenna luksusowa', FLOUR, { price: 4, brand: 'Lubella' }),
    product('f3', 'Mąka orkiszowa', FLOUR, { price: 12, brand: 'Melvit' }),
    product('f4', 'Mąka orkiszowa razowa', FLOUR, { grammage: 0.5, price: 7, brand: 'Melvit' }),
    product('f5', 'Mąka żytnia', FLOUR, { price: 5 }), // no brand
    product('f6', 'Mąka orkiszowa wyprzedana', FLOUR, { price: 99, isAvailable: false, brand: 'Should not count' }),
    product('p1', 'Makaron jajeczny', PASTA, { grammage: 0.5, price: 5 }),
    product('p2', 'Makaron spaghetti', PASTA, { grammage: 0.5, price: 4 }),
    product('s1', 'Cukier puder', SUGAR, { price: 8 }),
    product('s2', 'Cukier puder extra', SUGAR, { price: 10 }),
    product('c1', 'Cukierki owocowe', CANDY, { grammage: 0.1, price: 2 }),
    product('c2', 'Cukierki miętowe', CANDY, { grammage: 0.1, price: 3 }),
    product('c3', 'Cukierki krówki', CANDY, { grammage: 0.1, price: 3 }),
    product('e1', 'Jaja kurze - 10 szt.', EGGS, { unit: 'Piece', price: 12 }),
    product('e2', 'Jaja kurze L - 10 szt.', EGGS, { unit: 'Piece', price: 14 }),
    product('b1', 'Masło extra', BUTTER, { grammage: 0.2, price: 8 }),
    product('b2', 'Masło extra 82%', BUTTER, { grammage: 0.2, price: 9 }),
    product('b3', 'Masło klarowane', BUTTER, { grammage: 0.5, price: 30 }),
    product('b4', 'Masło roślinne', BUTTER, { grammage: 0.25, price: 7 }),
    product('b5', 'Masło orzechowe', BUTTER, { grammage: 0.3, price: 15 }),
    product('b6', 'Masło irlandzkie', BUTTER, { grammage: 0.2, price: 11 }),
    product('b7', 'Masło polskie', BUTTER, { grammage: 0.2, price: 6 }),
    // "Masa" is also a real, if rarer, word ("Masa cukrowa", "Masa krówkowa" - fondant, fudge).
    product('m1', 'Masa cukrowa', BAKING, { grammage: 0.25, price: 10 }),
    product('m2', 'Masa krówkowa', BAKING, { grammage: 0.4, price: 9 }),
    product('k1', 'Maska do włosów', COSMETICS, { unit: 'Litre', grammage: 0.2, price: 20 }),
    product('k2', 'Maska do twarzy', COSMETICS, { unit: 'Litre', grammage: 0.2, price: 25 }),
    product('v1', 'Ekstrakt z wanilii', BAKING, { unit: 'Litre', grammage: 0.05, price: 20 }),
    product('v2', 'Ekstrakt z wanilii bourbon', BAKING, { unit: 'Litre', grammage: 0.05, price: 30 }),
    // Catalogued under a generic description; the recognisable name is only in `brand`.
    product('n1', 'Krem do smarowania z orzechami', BAKING, { price: 11, brand: 'NUTELLA' }),
    product('n2', 'Krem do smarowania z orzechami mini', BAKING, { grammage: 0.35, price: 6, brand: 'NUTELLA' }),
    product('n3', 'Krem do smarowania z orzechami duopak', BAKING, { grammage: 0.75, price: 18, brand: 'NUTELLA' }),
    product('kd1', 'Biszkopt z mlecznym nadzieniem', BAKING, { price: 4, brand: 'KINDER' }),
    product('kd2', 'Wafel w czekoladzie', BAKING, { price: 5, brand: 'KINDER' }),
    product('kb1', 'Lody', BAKING, { price: 6, brand: 'KINDER BUENO' }),
    product('kb2', 'Batonik', BAKING, { grammage: 0.05, price: 2, brand: 'KINDER BUENO' }),
    // Only one SKU of this sub-brand is in stock, same as the real "Kinder Chocolate" ice cream.
    product('kc1', 'Lody czekoladowe', BAKING, { price: 7, brand: 'KINDER CHOCOLATE' }),
  ],
};

let api;
before(async () => {
  api = await setupApi();
});
beforeEach(() => importCatalog(db, feed));
after(() => db.destroy());

const suggest = async (q, extra = {}) => (await api.get('/api/v1/catalog/suggestions').query({ q, ...extra }).expect(200)).body;
const names = (list) => list.map((s) => `${s.name} (${s.productCount})`);

describe('name suggestions', () => {
  it('folds Polish letters', () => {
    assert.equal(fold('Mąka Żytnia ŁÓDŹ'), 'maka zytnia lodz');
  });

  it('completes the typed word and offers longer names', async () => {
    const res = await suggest('mąk');

    assert.deepEqual(
      res.main,
      {
        name: 'Mąka',
        productCount: 5,
        brands: [
          { name: 'Lubella', productCount: 2 },
          { name: 'Melvit', productCount: 2 },
        ],
      },
      'no price unless asked; unavailable products and products without a brand do not count',
    );
    assert.deepEqual(names(res.more), ['Mąka pszenna (2)', 'Mąka orkiszowa (2)'], 'names of a single product are left out');
    assert.deepEqual(res.others, [], '"mąk" does not match "makaron"');
  });

  it('suggests the most common manufacturers for a name', async () => {
    const res = await suggest('mąka psz');
    assert.deepEqual(res.main.brands, [{ name: 'Lubella', productCount: 2 }]);
  });

  it('works without Polish letters', async () => {
    const res = await suggest('maka');
    assert.equal(res.main.name, 'Mąka');
  });

  it('prefers the typed word over a longer one', async () => {
    const res = await suggest('cukier');
    assert.equal(res.main.name, 'Cukier');
    assert.deepEqual(names(res.more), ['Cukier puder (2)']);
  });

  it('adds the median price per kg, and per package when given', async () => {
    const orkisz = await suggest('mąka orkisz', { price: 'true' });
    assert.equal(orkisz.main.name, 'Mąka orkiszowa');
    // Per kg: 12 and 14
    assert.deepEqual(orkisz.main.price, { pricingUnit: 'kg', pricePerUnit: 13, low: 12.5, high: 13.5, sampleSize: 2, pricePerPackage: null });

    const flour = await suggest('mąka psz', { price: 'true', packageSize: 500, packageUnit: 'g' });
    assert.equal(flour.main.price.pricePerUnit, 3.5);
    assert.equal(flour.main.price.pricePerPackage, 1.75);
  });

  it('prices products sold by the piece per piece, using the count in the name', async () => {
    const res = await suggest('jaja', { price: 'true', packageSize: 6, packageUnit: 'piece' });
    assert.equal(res.main.price.pricingUnit, 'piece');
    assert.equal(res.main.price.pricePerUnit, 1.3);
    assert.equal(res.main.price.pricePerPackage, 7.8);
  });

  it('has no price in a unit the products are not sold in', async () => {
    const res = await suggest('mąk', { price: 'true', packageSize: 1, packageUnit: 'l' });
    assert.equal(res.main.price, null);
  });

  it('excludes only genuinely non-food categories', async () => {
    const butter = await suggest('masło');
    assert.equal(butter.main.name, 'Masło');
    assert.equal(butter.main.productCount, 7, 'cosmetics ("maska") must not count');
    assert.deepEqual(butter.others, [], 'cosmetics are excluded entirely, not just ranked below butter');

    const pasta = await suggest('makaron');
    assert.equal(pasta.main.name, 'Makaron', 'a savory staple is suggested too, not just pastry ingredients');
    assert.equal(pasta.main.productCount, 2);
  });

  it('prefers the more fully typed word over a more common one, scaled by how complete it is', async () => {
    // "cukie" is 83% of "cukier" (2 products) but only 63% of "cukierki" (3): close enough to win.
    assert.equal((await suggest('cukie')).main.name, 'Cukier');
    // "cuk" is only 50% of "cukier" against 37.5% of "cukierki": still enough to win here.
    assert.equal((await suggest('cuk')).main.name, 'Cukier');
  });

  it('still lets a much more common word win over a shorter, more complete but rarer one', async () => {
    // "mas" is 75% of "masa" (2 products) but only 60% of "masło" (7): not close enough this time,
    // since "masło" so heavily outnumbers "masa" that even its lower completeness wins.
    const res = await suggest('mas');
    assert.equal(res.main.name, 'Masło');
  });

  it('also matches a brand, since some products are catalogued under a generic description', async () => {
    const nutella = await suggest('nutella');
    assert.equal(nutella.main.name, 'Nutella');
    assert.equal(nutella.main.productCount, 3);

    // All 5 Kinder products aggregate under "Kinder", same as flour types under "Mąka"; the 2
    // "Kinder Bueno" ones also break out under `more`, but the lone "Kinder Chocolate" does not -
    // one product is too little to list as a family, but see below for why it is not dropped
    // entirely.
    const kinder = await suggest('kinder');
    assert.equal(kinder.main.name, 'Kinder');
    assert.equal(kinder.main.productCount, 5);
    assert.deepEqual(names(kinder.more), ['Kinder bueno (2)']);
  });

  it('still returns a single-product match as main when it is the only one that fits', async () => {
    // Exactly one "Kinder Chocolate" item is in stock; returning nothing would be worse than
    // surfacing it, even though a lone product is normally too little to call a "family".
    const res = await suggest('kinder choco');
    assert.deepEqual(res.main, { name: 'Kinder chocolate', productCount: 1, brands: [{ name: 'KINDER CHOCOLATE', productCount: 1 }] });
    assert.deepEqual(res.more, []);
    assert.deepEqual(res.others, []);
  });

  it('falls back to a word later in the name', async () => {
    const res = await suggest('wanil');
    assert.equal(res.main.name, 'Ekstrakt z wanilii');
  });

  it('returns nothing for unknown names', async () => {
    assert.deepEqual(await suggest('xyz'), { query: 'xyz', main: null, more: [], others: [] });
  });

  it('uses the newest import', async () => {
    await suggest('jaja');
    const cheaper = feed.products.map((p) => (p.id.startsWith('e') ? { ...p, price: { price: p.price.price / 2 } } : p));
    await importCatalog(db, { ...feed, products: cheaper });

    assert.equal((await suggest('jaja', { price: 'true' })).main.price.pricePerUnit, 0.65);
  });

  it('rejects a too short query and a package size without unit', async () => {
    const res = await api.get('/api/v1/catalog/suggestions').query({ q: ' m ', packageSize: 1 }).expect(400);
    assert.deepEqual(res.body.error.details.issues.map((i) => i.path).sort(), ['query.packageUnit', 'query.q']);
  });
});
