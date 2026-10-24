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

// A recipe's yield is a weight or a volume (count is what `portions` is for).
export const YIELD_UNITS = UNIT_NAMES.filter((unit) => UNITS[unit].group !== 'count');

// Units of a recipe ingredient line; 'portion' is only for sub-recipes.
export const INGREDIENT_UNITS = [...UNIT_NAMES, 'portion'];

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

// False for anything that isn't a product unit, such as 'portion'.
export function areCompatible(unitA, unitB) {
  return Object.hasOwn(UNITS, unitA) && Object.hasOwn(UNITS, unitB) && unitGroup(unitA) === unitGroup(unitB);
}

export function compatibleUnits(unit) {
  return UNIT_NAMES.filter((name) => areCompatible(name, unit));
}

// Units a sub-recipe can be used in: portions always, weight or volume only if it has a yield.
export function subRecipeUnits(yieldUnit) {
  return ['portion', ...(yieldUnit ? compatibleUnits(yieldUnit) : [])];
}

export function pricingUnitFor(unit) {
  return PRICING_UNITS[unitGroup(unit)];
}

export function convert(quantity, from, to) {
  if (!areCompatible(from, to)) throw new UnitMismatchError(from, to);
  return (quantity * UNITS[from].factor) / UNITS[to].factor;
}
