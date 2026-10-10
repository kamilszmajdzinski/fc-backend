// Every unit belongs to a group and converts to the group's base unit (g, ml or piece).
export const UNITS = {
  mg: { group: 'mass', factor: 0.001 },
  g: { group: 'mass', factor: 1 },
  kg: { group: 'mass', factor: 1000 },
  ml: { group: 'volume', factor: 1 },
  l: { group: 'volume', factor: 1000 },
  piece: { group: 'count', factor: 1 },
};

export const UNIT_NAMES = Object.keys(UNITS);

// The unit that "price per unit" refers to, per group.
const PRICING_UNITS = { mass: 'kg', volume: 'l', count: 'piece' };

export class UnitMismatchError extends Error {
  constructor(from, to) {
    super(`Cannot convert ${from} to ${to}: ${unitGroup(from)} and ${unitGroup(to)} are different kinds of units`);
    this.name = 'UnitMismatchError';
  }
}

export function unitGroup(unit) {
  return UNITS[unit].group;
}

export function areCompatible(unitA, unitB) {
  return unitGroup(unitA) === unitGroup(unitB);
}

export function compatibleUnits(unit) {
  return UNIT_NAMES.filter((name) => areCompatible(name, unit));
}

export function pricingUnitFor(unit) {
  return PRICING_UNITS[unitGroup(unit)];
}

export function convert(quantity, from, to) {
  if (!areCompatible(from, to)) throw new UnitMismatchError(from, to);
  return (quantity * UNITS[from].factor) / UNITS[to].factor;
}
