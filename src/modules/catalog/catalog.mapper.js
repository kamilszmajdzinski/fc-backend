import { round2OrNull, roundMarketPrice, toIsoDate } from '../../lib/format.js';
import { catalogBrand } from './catalog.kitchen.js';

// The catalog's whole-package size in kg / l reads better in g / ml below 1: 0.5 kg -> 500 g.
function productPackage(size, unit) {
  if (!(size > 0) || !unit) return { packageSize: null, packageUnit: null };
  const small = { kg: 'g', l: 'ml' }[unit];
  if (small && size < 1) return { packageSize: Number((size * 1000).toPrecision(12)), packageUnit: small };
  return { packageSize: size, packageUnit: unit };
}

/**
 * The user's own product as the catalog product would make it, to prefill the "add product"
 * form: the brand as manufacturer, the shelf price as the package price and the catalog's
 * category mapped onto the built-in ones. Fields the catalog doesn't have are null.
 */
export function toProductDraft(row) {
  return {
    name: row.name,
    manufacturer: catalogBrand(row.brand),
    category: row.kitchen_category,
    ...productPackage(row.package_size, row.package_unit),
    // An approximate market price (see roundMarketPrice), not the scraped shelf price.
    pricePerPackage: roundMarketPrice(row.price),
  };
}

// SQLite returns booleans as 0/1.
export function toCatalogProductDto(row) {
  return {
    id: row.id,
    ean: row.ean,
    name: row.name,
    brand: catalogBrand(row.brand),
    producer: row.producer,
    packageSize: row.package_size,
    packageUnit: row.package_unit,
    packCount: row.pack_count,
    // Shown as approximate average market prices (see roundMarketPrice), not the scraped shelf
    // prices: sorting and filtering still use the precise stored columns.
    price: roundMarketPrice(row.price),
    regularPrice: roundMarketPrice(row.regular_price),
    promotionPrice: roundMarketPrice(row.promotion_price),
    discountPercent: round2OrNull(row.discount_percent),
    pricePerUnit: roundMarketPrice(row.price_per_unit),
    pricingUnit: row.package_unit,
    vat: row.vat,
    isAvailable: Boolean(row.is_available),
    kitchenCategory: row.kitchen_category,
    primaryCategory: row.primary_category_id ? { id: row.primary_category_id, name: row.primary_category_name ?? null } : null,
    imageUrl: row.image_url,
    productUrl: row.product_url,
  };
}

export function toCatalogProductDetailDto(row, primaryCategoryPath) {
  return {
    ...toCatalogProductDto(row),
    nameEn: row.name_en,
    description: row.description,
    stock: row.stock,
    rating: row.rating,
    ratingVotes: row.rating_votes,
    countryOfOrigin: row.country_of_origin,
    primaryCategoryPath,
    productDraft: toProductDraft(row),
  };
}

export function toCatalogCategoryDto(row) {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    parentId: row.parent_id,
    depth: row.depth,
    productCount: row.product_count,
    hasChildren: Number(row.child_count) > 0,
    url: row.url,
  };
}

export function toCatalogStatusDto(row) {
  return {
    feedGeneratedAt: row?.feed_generated_at ?? null,
    importedAt: toIsoDate(row?.imported_at),
    categoryCount: row?.category_count ?? 0,
    productCount: row?.product_count ?? 0,
  };
}
