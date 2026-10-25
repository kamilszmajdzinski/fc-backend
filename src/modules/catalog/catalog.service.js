import db from '../../db/knex.js';
import { NotFoundError } from '../../lib/errors.js';
import { PRODUCT_CATEGORIES } from '../categories/categories.defaults.js';
import { toCatalogCategoryDto, toCatalogProductDetailDto, toCatalogProductDto, toCatalogStatusDto } from './catalog.mapper.js';

const SORT_COLUMNS = {
  name: 'p.name',
  brand: 'p.brand',
  price: 'p.price',
  pricePerUnit: 'p.price_per_unit',
  discountPercent: 'p.discount_percent',
};

function applyProductFilters(query, { search, categoryId, kitchen, kitchenCategory, brand, ean, unit, available, onSale, minPrice, maxPrice }) {
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    query.where((builder) =>
      builder
        .whereRaw('lower(p.name) like ?', [pattern])
        .orWhereRaw('lower(p.brand) like ?', [pattern])
        .orWhereRaw('lower(p.producer) like ?', [pattern]),
    );
  }
  if (categoryId) {
    query.whereExists(
      db('catalog_product_categories as pc').select(1).whereRaw('pc.product_id = p.id').whereIn('pc.category_id', categoryId),
    );
  }
  if (kitchen) query.whereNotNull('p.kitchen_category');
  if (kitchenCategory) query.where('p.kitchen_category', kitchenCategory);
  if (brand) query.whereRaw('lower(p.brand) = ?', [brand.toLowerCase()]);
  if (ean) query.where('p.ean', ean);
  if (unit) query.where('p.package_unit', unit);
  if (available !== undefined) query.where('p.is_available', available);
  if (onSale !== undefined) {
    query.where((builder) =>
      onSale ? builder.whereRaw('p.regular_price > p.price') : builder.whereNull('p.price').orWhereRaw('p.regular_price <= p.price'),
    );
  }
  if (minPrice !== undefined) query.where('p.price', '>=', minPrice);
  if (maxPrice !== undefined) query.where('p.price', '<=', maxPrice);
  return query;
}

// Paged. Products without a value for the sort field (e.g. no price) come last in both directions.
export async function listCatalogProducts(params) {
  const { sort, limit, offset } = params;
  const base = applyProductFilters(db('catalog_products as p'), params);

  const [{ total }] = await base.clone().count({ total: '*' });
  const descending = sort.startsWith('-');
  const column = SORT_COLUMNS[descending ? sort.slice(1) : sort];
  const rows = await base
    .leftJoin('catalog_categories as c', 'c.id', 'p.primary_category_id')
    .select('p.*', 'c.name as primary_category_name')
    // Knex's own "nulls last" option drops the column on SQLite, so spell it out.
    .orderByRaw(`(?? is null), ?? ${descending ? 'desc' : 'asc'}`, [column, column])
    .orderBy('p.id')
    .limit(limit)
    .offset(offset);

  return { items: rows.map(toCatalogProductDto), total: Number(total), limit, offset };
}

// [{ id, name }] from the top-level category down to `path`'s own category.
async function categoryPath(path) {
  const ids = path.split(',').reverse();
  const rows = await db('catalog_categories').whereIn('id', ids).select('id', 'name');
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) }));
}

export async function getCatalogProduct(id) {
  const row = await db('catalog_products as p')
    .leftJoin('catalog_categories as c', 'c.id', 'p.primary_category_id')
    .where('p.id', id)
    .first('p.*', 'c.name as primary_category_name', 'c.path as primary_category_path');
  if (!row) throw new NotFoundError('Catalog product', id);
  return toCatalogProductDetailDto(row, row.primary_category_path ? await categoryPath(row.primary_category_path) : []);
}

function categoriesQuery() {
  const childCount = db('catalog_categories as ch').count('*').whereRaw('ch.parent_id = c.id').as('child_count');
  return db('catalog_categories as c').select('c.*', childCount);
}

// Names repeat across the tree (the BIO and local supplier trees mirror the main one), so search
// results carry their path.
export async function listCatalogCategories({ parentId, search }) {
  if (search) {
    const rows = await categoriesQuery()
      .whereRaw('lower(c.name) like ?', [`%${search.toLowerCase()}%`])
      .orderBy('c.depth')
      .orderBy('c.name')
      .orderBy('c.id')
      .limit(50);
    return Promise.all(rows.map(async (row) => ({ ...toCatalogCategoryDto(row), path: await categoryPath(row.path) })));
  }
  const query = categoriesQuery().orderBy('c.name');
  if (parentId) query.where('c.parent_id', parentId);
  else query.whereNull('c.parent_id');
  return (await query).map(toCatalogCategoryDto);
}

export async function getCatalogCategory(id) {
  const row = await categoriesQuery().where('c.id', id).first();
  if (!row) throw new NotFoundError('Catalog category', id);
  const children = await categoriesQuery().where('c.parent_id', id).orderBy('c.name');
  return { ...toCatalogCategoryDto(row), path: await categoryPath(row.path), children: children.map(toCatalogCategoryDto) };
}

export async function getCatalogStatus() {
  return toCatalogStatusDto(await db('catalog_imports').orderBy('id', 'desc').first());
}

/**
 * The built-in kitchen categories with how many catalog products are in each (only available
 * ones with `available`), in the built-in order. A kitchen-oriented alternative to Frisco's own
 * category tree.
 */
export async function listKitchenCategories({ available } = {}) {
  const query = db('catalog_products').whereNotNull('kitchen_category').groupBy('kitchen_category').select('kitchen_category', db.raw('count(*) as count'));
  if (available !== undefined) query.where('is_available', available);
  const counts = new Map((await query).map((row) => [row.kitchen_category, Number(row.count)]));
  return PRODUCT_CATEGORIES.filter((name) => counts.has(name)).map((name) => ({ name, productCount: counts.get(name) }));
}
