import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { round2, round6 } from '../src/lib/format.js';
import { ingredientUnitPrice, resolvePrices } from '../src/modules/recipes/costing.js';

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`);
}

const butter = { packageSize: 200, packageUnit: 'g', pricePerPackage: 8 };
const flour = { packageSize: 1, packageUnit: 'kg', pricePerPackage: 3 };
const eggs = { packageSize: 10, packageUnit: 'piece', pricePerPackage: 12 };

describe('resolvePrices', () => {
  it('derives price per unit from price per package', () => {
    assertClose(resolvePrices(butter).pricePerUnit, 40);
    assertClose(resolvePrices(eggs).pricePerUnit, 1.2);
    assertClose(resolvePrices({ packageSize: 500, packageUnit: 'ml', pricePerPackage: 9 }).pricePerUnit, 18);
  });

  it('derives price per package from price per unit', () => {
    const prices = resolvePrices({ packageSize: 250, packageUnit: 'g', pricePerUnit: 40 });
    assertClose(prices.pricePerPackage, 10);
    assert.equal(prices.pricePerUnit, 40);
  });

  it('uses price per package when both are given', () => {
    assertClose(resolvePrices({ ...butter, pricePerUnit: 999 }).pricePerUnit, 40);
  });
});

describe('ingredientUnitPrice', () => {
  it('prices one unit of the ingredient', () => {
    assertClose(ingredientUnitPrice(butter, 'g'), 0.04);
    assertClose(ingredientUnitPrice(butter, 'kg'), 40);
    assertClose(ingredientUnitPrice(butter, 'mg'), 0.00004);
    assertClose(ingredientUnitPrice(flour, 'g'), 0.003);
    assertClose(ingredientUnitPrice(eggs, 'piece'), 1.2);
  });

  it('gives the expected food cost for the reference recipe', () => {
    const foodCost =
      250 * ingredientUnitPrice(butter, 'g') + 300 * ingredientUnitPrice(flour, 'g') + 2 * ingredientUnitPrice(eggs, 'piece');
    assert.equal(round2(foodCost), 13.3);
    assert.equal(round2(foodCost / 10), 1.33);
  });
});

describe('rounding', () => {
  it('rounds half up despite float noise', () => {
    assert.equal(round2(18.225), 18.23);
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(0.9000000000000001), 0.9);
    assert.equal(round6(0.00004), 0.00004);
  });
});
