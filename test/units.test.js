import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UnitMismatchError, areCompatible, compatibleUnits, convert, pricingUnitFor } from '../src/lib/units.js';

describe('units', () => {
  it('converts within the same group', () => {
    assert.equal(convert(1, 'kg', 'g'), 1000);
    assert.equal(convert(500, 'mg', 'g'), 0.5);
    assert.equal(convert(200, 'g', 'kg'), 0.2);
    assert.equal(convert(0.5, 'l', 'ml'), 500);
    assert.equal(convert(12, 'piece', 'piece'), 12);
  });

  it('refuses to convert between groups', () => {
    assert.throws(() => convert(100, 'g', 'ml'), UnitMismatchError);
    assert.throws(() => convert(1, 'piece', 'kg'), UnitMismatchError);
  });

  it('knows which units are compatible', () => {
    assert.equal(areCompatible('mg', 'kg'), true);
    assert.equal(areCompatible('ml', 'g'), false);
    assert.deepEqual(compatibleUnits('g'), ['mg', 'g', 'kg']);
    assert.deepEqual(compatibleUnits('l'), ['ml', 'l']);
    assert.deepEqual(compatibleUnits('piece'), ['piece']);
  });

  it('prices per kg, per l or per piece', () => {
    assert.equal(pricingUnitFor('mg'), 'kg');
    assert.equal(pricingUnitFor('ml'), 'l');
    assert.equal(pricingUnitFor('piece'), 'piece');
  });
});
