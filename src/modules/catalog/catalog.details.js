import db from '../../db/knex.js';
import { round2 } from '../../lib/format.js';
import { catalogBrand } from './catalog.kitchen.js';
import { fold, startsWord, tokens } from './catalog.suggest.js';

// Drinks and alcohol come in every flavour ("Cytryna" is mostly lemon beer and vodka), so they
// count for less than the ingredient itself and win only when little else matches ("Rum").
const CATEGORY_WEIGHTS = { 'Napoje i alkohole': 0.25 };
const ALTERNATIVES_LIMIT = 3;
const MANUFACTURER_ALTERNATIVES_LIMIT = 4;
// An alternative needs at least this share of the matching products to be worth showing.
const MIN_ALTERNATIVE_SHARE = 0.1;

// The catalog changes only on import, so it is kept in memory and reloaded after a new import.
let cache = null;

async function loadProducts() {
  const latest = await db('catalog_imports').max({ id: 'id' }).first();
  if (cache?.importId === latest?.id) return cache.products;

  // Kitchen products only (catalog.kitchen.js).
  const rows = await db('catalog_products').whereNotNull('kitchen_category').select('name', 'brand', 'kitchen_category');
  const products = rows.map((row) => ({
    category: row.kitchen_category,
    brand: catalogBrand(row.brand),
    tokens: tokens(row.name),
    brandTokens: row.brand ? tokens(row.brand) : null,
  }));
  cache = { importId: latest?.id, products };
  return products;
}

// Same comparison as startsWord, but for the whole word.
function isWord(token, queryWord) {
  return (queryWord === fold(queryWord) ? fold(token) : token) === queryWord;
}

/**
 * Products whose name (or brand) has the query's words in a row, starting with the first word
 * or, failing that, up to two words in ("cukier wanilinowy" for "wanilinowy"). When some of them
 * have the last query word in full, only those count: "cukier" is sugar, not "Cukierki".
 */
function matchingProducts(products, queryWords) {
  const matchesAt = (t, offset) => queryWords.every((q, i) => t[offset + i] && startsWord(t[offset + i], q));
  for (const maxOffset of [0, 2]) {
    const found = [];
    for (const product of products) {
      for (const t of [product.tokens, product.brandTokens]) {
        if (!t) continue;
        const offset = [...Array(maxOffset + 1).keys()].find((o) => matchesAt(t, o));
        if (offset !== undefined) {
          found.push({ product, lastWord: t[offset + queryWords.length - 1] });
          break;
        }
      }
    }
    if (found.length === 0) continue;
    const whole = found.filter((match) => isWord(match.lastWord, queryWords.at(-1)));
    return (whole.length > 0 ? whole : found).map((match) => match.product);
  }
  return [];
}

// { value, confidence, alternatives } from (value, weight) pairs, most weight first. confidence is
// the value's share of the total weight.
function pickBest(weighted, alternativesLimit, minAlternativeShare = 0) {
  const totals = new Map();
  for (const { value, weight } of weighted) totals.set(value, (totals.get(value) ?? 0) + weight);
  const total = [...totals.values()].reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return null;
  const ranked = [...totals].map(([value, weight]) => ({ value, share: weight / total })).sort((a, b) => b.share - a.share);
  return {
    value: ranked[0].value,
    confidence: round2(ranked[0].share),
    alternatives: ranked
      .slice(1)
      .filter((item) => item.share >= minAlternativeShare)
      .slice(0, alternativesLimit)
      .map((item) => item.value),
  };
}

/**
 * The likely built-in category and manufacturer (brand) for a product name, from the catalog
 * products with a similar name: { category, manufacturer }, each { value, confidence,
 * alternatives } or null. Words the catalog doesn't know are dropped from the end ("Mąka pszenna
 * Szymanowska 1kg" still finds flour). Both null when nothing matches.
 */
export async function suggestCatalogDetails(name) {
  const products = await loadProducts();
  const words = tokens(name);
  for (let length = words.length; length > 0; length--) {
    const matches = matchingProducts(products, words.slice(0, length));
    if (matches.length === 0) continue;
    const category = pickBest(
      matches.map((product) => ({ value: product.category, weight: CATEGORY_WEIGHTS[product.category] ?? 1 })),
      ALTERNATIVES_LIMIT,
      MIN_ALTERNATIVE_SHARE,
    );
    // Brands of the suggested category only: lemons, not lemon beer. The shop's own labels are
    // already null.
    const manufacturer = pickBest(
      matches
        .filter((product) => product.brand && product.category === category.value)
        .map((product) => ({ value: product.brand, weight: 1 })),
      MANUFACTURER_ALTERNATIVES_LIMIT,
    );
    return { category, manufacturer };
  }
  return { category: null, manufacturer: null };
}
