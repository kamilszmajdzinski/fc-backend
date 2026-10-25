// Pure helpers shared by the catalog import, its migration and the suggestions: no database here.

// Frisco category name -> built-in product category (categories.defaults.js). Names, not ids: they
// survive a re-import, and the BIO and local supplier trees repeat the main tree's names. A product
// takes the mapping of its most specific mapped category, so "Kakao" under "Kawa, herbata, kakao"
// gives "Czekolada i kakao", not "Napoje i alkohole". Products with no mapped category (cosmetics,
// ready meals, ...) aren't kitchen products: the catalog screen and suggestions leave them out.
export const CATALOG_CATEGORY_MAP = {
  'Sypkie i produkty zbożowe': 'Mąka i produkty zbożowe',
  'Musli, płatki, granole': 'Mąka i produkty zbożowe',
  'Cukier i słodziki': 'Cukier i słodziki',
  'Cukier waniliowy i inne': 'Cukier i słodziki',
  'Nabiał, jaja, sery': 'Nabiał',
  'Alternatywy mleka': 'Nabiał',
  'Mleczko i krem kokosowy': 'Nabiał',
  Jaja: 'Jaja',
  'Masło i margaryny': 'Tłuszcze',
  'Oleje, oliwy, octy': 'Tłuszcze',
  Ocet: 'Przyprawy',
  'Krem z octu balsamicznego': 'Przyprawy',
  Czekolady: 'Czekolada i kakao',
  'Czekoladki, bombonierki': 'Czekolada i kakao',
  Kakao: 'Czekolada i kakao',
  'Kakao naturalne': 'Czekolada i kakao',
  Bakalie: 'Orzechy i nasiona',
  Orzeszki: 'Orzechy i nasiona',
  'Owoce suszone': 'Owoce suszone',
  'Jabłka i gruszki': 'Owoce',
  Egzotyczne: 'Owoce',
  'Pozostałe owoce': 'Owoce',
  Cytrusy: 'Owoce',
  'Owoce sezonowe': 'Owoce',
  Awokado: 'Owoce',
  Banany: 'Owoce',
  Owoce: 'Owoce',
  'Owoce konserwowe': 'Owoce',
  'Dżemy, miody i kremy': 'Dżemy, miody i kremy',
  'Wypieki i desery': 'Dodatki do wypieków',
  // Gelatin is also filed under "Cukier i słodziki > Inne rodzaje cukru".
  'Środki żelujące': 'Dodatki do wypieków',
  'Przyprawy i zioła': 'Przyprawy',
  Sól: 'Przyprawy',
  'Sałaty, kiełki i mikroliście': 'Warzywa',
  'Pozostałe warzywa': 'Warzywa',
  'Zioła i natki': 'Warzywa',
  'Kiszonki, surówki i sałatki': 'Warzywa',
  'Marchew, ziemniaki, rzodkiewka': 'Warzywa',
  Grzyby: 'Warzywa',
  'Cebula, czosnek, por': 'Warzywa',
  Papryka: 'Warzywa',
  Pomidory: 'Warzywa',
  'Warzywa sezonowe': 'Warzywa',
  Ogórki: 'Warzywa',
  Warzywa: 'Warzywa',
  'Warzywa konserwowe': 'Warzywa',
  'Przetwory warzywne': 'Warzywa',
  Strączki: 'Warzywa',
  'Mięso i wędliny': 'Mięso i ryby',
  'Ryby i owoce morza': 'Mięso i ryby',
  Napoje: 'Napoje i alkohole',
  Alkohole: 'Napoje i alkohole',
  'Kawa, herbata, kakao': 'Napoje i alkohole',
  'Słodycze, przekąski, bakalie': 'Słodycze i przekąski',
  'Z piekarni i cukierni': 'Pieczywo',
  'Piekarnicze i cukiernicze': 'Pieczywo',
};

/**
 * The built-in category of a catalog product, from all its category links ({ name, depth }): its
 * most specific mapped category's. null for products that aren't kitchen products.
 */
export function kitchenCategory(links) {
  return links.toSorted((a, b) => b.depth - a.depth).map((link) => CATALOG_CATEGORY_MAP[link.name]).find(Boolean) ?? null;
}

// The shop's own labels ("FRISCO FRESH", "FRISCO ORGANIC") say where the catalog comes from, so
// they aren't shown as a brand or suggested as a manufacturer.
export function isStoreBrand(brand) {
  return /^frisco\b/i.test(brand.trim());
}

// Frisco writes most brands in capitals ("ŻABCZYŃSCY", "OSM ŁOWICZ"). Those read better as
// "Żabczyńscy" and "OSM Łowicz": short words stay as they are, since they are mostly acronyms.
function displayBrand(brand) {
  if (brand !== brand.toUpperCase()) return brand;
  return brand.replace(/\p{L}{4,}/gu, (word) => word.charAt(0) + word.slice(1).toLowerCase());
}

/** A catalog brand as the app shows it: normal case, and null for the shop's own labels. */
export function catalogBrand(brand) {
  return brand && !isStoreBrand(brand) ? displayBrand(brand) : null;
}
