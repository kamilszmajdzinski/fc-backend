import { round2OrNull, toIsoDate } from '../../lib/format.js';

// SQLite returns booleans as 0/1.
export function toCatalogProductDto(row) {
  return {
    id: row.id,
    ean: row.ean,
    name: row.name,
    brand: row.brand,
    producer: row.producer,
    packageSize: row.package_size,
    packageUnit: row.package_unit,
    packCount: row.pack_count,
    price: round2OrNull(row.price),
    regularPrice: round2OrNull(row.regular_price),
    promotionPrice: round2OrNull(row.promotion_price),
    discountPercent: round2OrNull(row.discount_percent),
    pricePerUnit: round2OrNull(row.price_per_unit),
    pricingUnit: row.package_unit,
    vat: row.vat,
    isAvailable: Boolean(row.is_available),
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
