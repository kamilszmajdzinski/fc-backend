import db from '../../db/knex.js';
import { round2 } from '../../lib/format.js';
import { convert, pricingUnitFor } from '../../lib/units.js';

// Top-level categories that are never kitchen ingredients: cosmetics, home cleaning, pets, office
// and school supplies, baby products, health supplements, home accessories, gift boxes. Everything
// else (Spiżarnia, Nabiał, Mięso, Warzywa i owoce, Ryby, Mrożone, Z piekarni, Kawa/herbata, Słodycze,
// Napoje, Alkohole, BIO, Lokalni dostawcy, ...) is in, since a kitchen can need any of it, from
// flour and sugar to pepper, salt and parmesan.
const EXCLUDED_ROOTS = new Set(['21336', '21502', '21659', '21893', '21188', '22003', '21793', '22030']);
// A name needs at least this many products behind it to be suggested.
const MIN_PRODUCTS = 2;
const MORE_LIMIT = 5;
const OTHERS_LIMIT = 3;
const BRANDS_LIMIT = 5;
// A suggestion may run on through these: "mąka pszenna do pizzy".
const LINK_WORDS = new Set(['do', 'z', 'ze', 'w', 'we', 'na', 'bez', 'dla', 'i', 'o']);

// "Mąka Żytnia" -> "maka zytnia", so users can type with or without Polish letters.
export function fold(text) {
  return text.toLowerCase().replaceAll('ł', 'l').normalize('NFD').replace(/\p{M}/gu, '');
}

// A fat or alcohol percentage matters for dairy and other products ("Śmietana 18%" and "30%" are
// different ingredients), so it is merged into one token before the general split below, which
// would otherwise break "3,2%" into "3" and "2%" on the decimal comma. The decimal separator is
// swapped for U+201A so it survives that split too; toPhraseName swaps it back for display.
const mergePercent = (text) => text.replace(/(\d+)[.,]\s*(\d+)\s*%/g, '$1‚$2%').replace(/(\d+)\s+%/g, '$1%');
const isPercent = (token) => /^\d+(‚\d+)?%$/.test(token);

const tokens = (text) => mergePercent(text).toLowerCase().split(/[\s,.()\-–/]+/).filter(Boolean);
const isWord = (token) => /^\p{L}{2,}$/u.test(token);
// A real word or a percentage makes a suggestion; "typ 450" or "1kg" end it.
const isNameToken = (token) => isWord(token) || isPercent(token);
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const toPhraseName = (key) => capitalize(key.replaceAll('‚', ','));

// A query word with Polish letters is compared as typed ("mąk" must not match "makaron"); one
// without them is compared folded ("maka" matches "mąka").
function startsWord(token, queryWord) {
  return (queryWord === fold(queryWord) ? fold(token) : token).startsWith(queryWord);
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * (pos - lower);
}

// The catalog changes only on import, so it is kept in memory and reloaded after a new import.
let cache = null;

async function loadProducts() {
  const latest = await db('catalog_imports').max({ id: 'id' }).first();
  if (cache?.importId === latest?.id) return cache.products;

  const [rows, links] = await Promise.all([
    db('catalog_products')
      .where('is_available', true)
      .whereNotNull('price_per_unit')
      .select('id', 'name', 'brand', 'price_per_unit', 'package_unit'),
    // Each row's category links already include every ancestor of every category the product is
    // in, so this gives each product's own top-level categories.
    db('catalog_product_categories as pc')
      .join('catalog_categories as c', 'c.id', 'pc.category_id')
      .where('c.depth', 0)
      .select('pc.product_id', 'pc.category_id'),
  ]);
  const roots = Map.groupBy(links, (link) => link.product_id);
  const isKitchenIngredient = (row) => {
    const productRoots = roots.get(row.id) ?? [];
    return productRoots.length === 0 || productRoots.some((link) => !EXCLUDED_ROOTS.has(link.category_id));
  };

  const products = rows
    .filter(isKitchenIngredient)
    .map((row) => ({ ...row, tokens: tokens(row.name), brandTokens: row.brand ? tokens(row.brand) : null }));
  cache = { importId: latest?.id, products };
  return products;
}

/**
 * Names taken from the start of a token list (a product's own name by default, or its brand): the
 * words up to the end of the query ("base"), and the same plus one more word ("Nutella" ->
 * "Krem..." with brand "NUTELLA" gives base "nutella"; "Kinder" with brand "KINDER BUENO" also
 * gives "kinder bueno"). The query may start up to `maxOffset` words in ("cukier wanilinowy" for
 * "wanil"); that is only used when no product name starts with the query.
 */
function collectPhrases(products, queryWords, maxOffset, getTokens = (product) => product.tokens) {
  const phrases = new Map();
  const add = (words, product, base) => {
    const key = words.join(' ');
    if (!phrases.has(key)) phrases.set(key, { key, words, base, products: [] });
    phrases.get(key).products.push(product);
  };

  for (const product of products) {
    const t = getTokens(product);
    if (!t) continue;
    for (let offset = 0; offset <= maxOffset; offset++) {
      if (!queryWords.every((q, i) => t[offset + i] && startsWord(t[offset + i], q))) continue;
      const base = t.slice(0, offset + queryWords.length);
      if (!base.every((token) => isNameToken(token) || LINK_WORDS.has(token))) break;
      add(base, product, true);
      let next = t.slice(base.length, base.length + 1);
      if (LINK_WORDS.has(next[0])) next = t.slice(base.length, base.length + 2);
      if (next.length > 0 && next.every(isNameToken) && !LINK_WORDS.has(next.at(-1))) add([...base, ...next], product, false);
      break;
    }
  }
  // Unfiltered: a single-product match still needs to reach `main` when it is all there is ("kinder
  // bu" only has one "Kinder Bueno" item in stock). MIN_PRODUCTS instead declutters `more`/`others`.
  return [...phrases.values()].sort((a, b) => b.products.length - a.products.length);
}

// The most common manufacturers behind a name, to suggest for the product's own brand field.
function brandsOf(products) {
  const counts = new Map();
  for (const { brand } of products) {
    if (brand) counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, BRANDS_LIMIT)
    .map(([name, productCount]) => ({ name, productCount }));
}

// Median price per kg / l / piece of the products behind a name, and the package price if asked.
function priceOf(products, { packageSize, packageUnit }) {
  const byUnit = Map.groupBy(products, (product) => product.package_unit);
  const unit = packageUnit ? pricingUnitFor(packageUnit) : [...byUnit].sort((a, b) => b[1].length - a[1].length)[0][0];
  const prices = (byUnit.get(unit) ?? []).map((product) => product.price_per_unit).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const median = quantile(prices, 0.5);
  return {
    pricingUnit: unit,
    pricePerUnit: round2(median),
    low: round2(quantile(prices, 0.25)),
    high: round2(quantile(prices, 0.75)),
    sampleSize: prices.length,
    pricePerPackage: packageSize ? round2(median * convert(packageSize, packageUnit, unit)) : null,
  };
}

/**
 * Name suggestions for the "add product" form, taken from the start of catalog product names,
 * which put the product's own noun first ("Mąka pszenna tortowa typ 450").
 * - main: the most likely name: the most common completion ("mąk" -> "Mąka"), or the typed word
 *   itself when names start with it often enough ("cukier", not "cukierki").
 * - more: the main name plus one word, most common first ("Mąka pszenna", "Mąka orkiszowa").
 * - others: other completions of the query ("mas" -> "Mascarpone" next to "Masło").
 * A query also matches a brand name, not just a product's own name, since many products are
 * catalogued under a generic description with the recognisable name only in `brand` ("nutella" ->
 * "Nutella", from products named "Krem do smarowania..."; "kinder" aggregates every Kinder product
 * the same way "mąka" aggregates every flour, with "Kinder Bueno" broken out under `more`).
 * Each suggestion also has `brands`, the most common manufacturers behind it, to suggest for the
 * product's own brand field. With `price`, it also has the median price of the products behind it.
 */
export async function suggestNames({ q, price, packageSize, packageUnit }) {
  const products = await loadProducts();
  const queryWords = tokens(q);
  let phrases = collectPhrases(products, queryWords, 0);
  if (phrases.length === 0) phrases = collectPhrases(products, queryWords, 2);
  const brandPhrases = collectPhrases(products, queryWords, 0, (product) => product.brandTokens);
  if (brandPhrases.length > 0) phrases = [...phrases, ...brandPhrases].sort((a, b) => b.products.length - a.products.length);

  const candidates = phrases.filter((p) => p.base);
  if (candidates.length === 0) return { query: q, main: null, more: [], others: [] };
  // How much of a candidate's own word the user has already typed (1 = the full word): "cukie" is
  // 83% of "cukier" but only 63% of "cukierki". The most "typed-out" candidate wins over the most
  // common one unless its count is too low to be believable, scaled by that completeness, so a
  // word typed in full can still lose a landslide ("orzech", 3, loses to "orzechy", 43) while a
  // barely-complete short word needs to be close in count to win at all ("mas" -> "masło" (20),
  // not "masa" (5), even though "masa" is the more complete match for those 3 letters).
  const lastQueryWord = queryWords.at(-1) ?? '';
  const completeness = (candidate) => lastQueryWord.length / candidate.words.at(-1).length;
  const [mostComplete] = [...candidates].sort((a, b) => completeness(b) - completeness(a) || b.products.length - a.products.length);
  const main = mostComplete.products.length * 4 * completeness(mostComplete) >= candidates[0].products.length ? mostComplete : candidates[0];

  const toSuggestion = (phrase) => ({
    name: toPhraseName(phrase.key),
    productCount: phrase.products.length,
    brands: brandsOf(phrase.products),
    ...(price ? { price: priceOf(phrase.products, { packageSize, packageUnit }) } : {}),
  });
  // A single-product name is fine as `main` (it may be all there is) but would just be clutter
  // alongside it, so `more` and `others` still need MIN_PRODUCTS.
  const hasEnough = (p) => p.products.length >= MIN_PRODUCTS;
  return {
    query: q,
    main: toSuggestion(main),
    more: phrases.filter((p) => !p.base && p.key.startsWith(`${main.key} `) && hasEnough(p)).slice(0, MORE_LIMIT).map(toSuggestion),
    others: candidates.filter((p) => p !== main && hasEnough(p)).slice(0, OTHERS_LIMIT).map(toSuggestion),
  };
}
