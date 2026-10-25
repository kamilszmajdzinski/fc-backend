import { round2, toIsoDate } from '../../lib/format.js';
import { pricingUnitFor } from '../../lib/units.js';
import { resolvePrices } from '../recipes/costing.js';

// API fields (camelCase) -> database row (snake_case), with the derived price filled in.
export function toProductRow(data) {
  const { pricePerPackage, pricePerUnit } = resolvePrices(data);
  return {
    name: data.name,
    description: data.description ?? null,
    manufacturer: data.manufacturer ?? null,
    category: data.category ?? null,
    package_size: data.packageSize,
    package_unit: data.packageUnit,
    price_per_package: pricePerPackage,
    price_per_unit: pricePerUnit,
    inventory_quantity: data.inventoryQuantity ?? 0,
  };
}

// Database row -> the editable API fields, used to apply a PATCH on top of the stored product.
export function fromProductRow(row) {
  return {
    name: row.name,
    description: row.description,
    manufacturer: row.manufacturer,
    category: row.category,
    packageSize: row.package_size,
    packageUnit: row.package_unit,
    pricePerPackage: row.price_per_package,
    pricePerUnit: row.price_per_unit,
    inventoryQuantity: row.inventory_quantity,
  };
}

export function toProductDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    manufacturer: row.manufacturer,
    category: row.category,
    packageSize: row.package_size,
    packageUnit: row.package_unit,
    pricePerPackage: round2(row.price_per_package),
    pricePerUnit: round2(row.price_per_unit),
    pricingUnit: pricingUnitFor(row.package_unit),
    inventoryQuantity: row.inventory_quantity,
    usageCount: Number(row.usage_count ?? 0),
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
  };
}
