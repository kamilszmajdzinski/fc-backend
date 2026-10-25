// Official public feed of the whole Frisco.pl catalog (~60 MB JSON, regenerated daily), offered in
// https://www.frisco.pl/robots.txt for personal, non-commercial use.
export const FEED_URL = 'https://commerce.frisco.pl/api/v1/integration/feeds/public?language=pl';

const UNITS = { Kilogram: 'kg', Litre: 'l', Piece: 'piece' };
const CHUNK_SIZE = 500;

export async function downloadFeed(url = FEED_URL) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fc-backend-catalog/1.0' } });
  if (!res.ok) throw new Error(`Feed download failed: HTTP ${res.status}`);
  return res.json();
}

function toCategoryRow(category) {
  return {
    id: String(category.id),
    parent_id: category.parentId ? String(category.parentId) : null,
    depth: category.depth ?? 0,
    name: category.name?.pl ?? category.name?.en ?? '',
    name_en: category.name?.en ?? null,
    path: category.parentPath ?? String(category.id),
    product_count: category.productCount ?? 0,
    url: category.categoryUrl ?? null,
  };
}

// For products sold by the piece the feed's grammage is 1 (one package); the count is only in the
// name: "Jaja kurze (rozmiar L) - 10 szt."
function packageSizeOf(product) {
  const count = product.unitOfMeasure === 'Piece' ? product.name?.pl?.match(/(\d+)\s*szt\b/)?.[1] : null;
  if (count && Number(count) > 0) return Number(count);
  return product.grammage > 0 ? product.grammage : null;
}

function toProductRow(product) {
  const price = product.price?.price ?? null;
  // priceBeforeDiscount is only there while the shelf price is reduced.
  const regularPrice = product.price?.priceBeforeDiscount ?? price;
  const packageSize = packageSizeOf(product);
  return {
    id: String(product.id),
    ean: product.ean ?? null,
    name: product.name?.pl ?? product.name?.en ?? '',
    name_en: product.name?.en ?? null,
    brand: product.brand ?? null,
    producer: product.producer ?? null,
    primary_category_id: product.primaryCategory?.categoryId ?? null,
    package_size: packageSize,
    package_unit: UNITS[product.unitOfMeasure] ?? null,
    pack_count: product.packSize ?? 1,
    price,
    regular_price: regularPrice,
    // A promotion with conditions, e.g. buying several or a minimum order value.
    promotion_price: product.price?.priceAfterPromotion ?? null,
    discount_percent: price != null && regularPrice > price ? ((regularPrice - price) / regularPrice) * 100 : null,
    price_per_unit: price != null && packageSize ? price / packageSize : null,
    vat: product.vat ?? null,
    is_available: product.isAvailable === true,
    stock: product.stock ?? null,
    rating: product.rating?.rating ?? null,
    rating_votes: product.rating?.votes ?? null,
    country_of_origin: product.countryOfOrigin ?? null,
    description: product.description ?? null,
    image_url: product.imageUrl ?? null,
    product_url: product.productUrl ?? null,
  };
}

// Every category the product is in, plus all their ancestors (parentPath lists them).
function toCategoryLinks(product) {
  const ids = new Set();
  for (const category of product.categories ?? []) {
    for (const id of (category.parentPath ?? category.categoryId ?? '').split(',')) {
      if (id) ids.add(id);
    }
  }
  return [...ids].map((categoryId) => ({ product_id: String(product.id), category_id: categoryId }));
}

/**
 * Replaces the whole catalog with the feed's contents in one transaction, so readers see either
 * the old catalog or the new one. Returns what was imported.
 */
export async function importCatalog(db, feed) {
  if (!Array.isArray(feed?.categories) || !Array.isArray(feed?.products)) {
    throw new Error('The feed has no categories or products list');
  }
  const categories = feed.categories.map(toCategoryRow);
  const products = feed.products.map(toProductRow);
  const links = feed.products.flatMap(toCategoryLinks);

  await db.transaction(async (trx) => {
    await trx('catalog_product_categories').del();
    await trx('catalog_products').del();
    await trx('catalog_categories').del();
    await trx.batchInsert('catalog_categories', categories, CHUNK_SIZE);
    await trx.batchInsert('catalog_products', products, CHUNK_SIZE);
    await trx.batchInsert('catalog_product_categories', links, CHUNK_SIZE);
    await trx('catalog_imports').insert({
      feed_generated_at: feed.generatedAt ?? null,
      category_count: categories.length,
      product_count: products.length,
    });
  });

  return { generatedAt: feed.generatedAt ?? null, categoryCount: categories.length, productCount: products.length };
}
