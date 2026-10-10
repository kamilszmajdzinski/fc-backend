// Demo data for local development: npm run seed (replaces all existing data).
import { recordChange, recordProductPriceChange } from '../../modules/history/history.recorder.js';
import { loadRecipeSnapshot, productSnapshot } from '../../modules/history/snapshots.js';
import { toProductRow } from '../../modules/products/products.mapper.js';
import { recalculateRecipeCosts } from '../../modules/recipes/costing.js';

const products = [
  { name: 'Masło 82%', manufacturer: 'Mleczarnia Pod Lasem', description: 'Masło niesolone', packageSize: 200, packageUnit: 'g', pricePerPackage: 8, inventoryQuantity: 1000 },
  { name: 'Mąka pszenna typ 450', manufacturer: 'Młyn Zbożowy', packageSize: 1, packageUnit: 'kg', pricePerPackage: 3, inventoryQuantity: 5 },
  { name: 'Cukier drobny', manufacturer: 'Cukrownia Słodka', packageSize: 1, packageUnit: 'kg', pricePerPackage: 4.5, inventoryQuantity: 3 },
  { name: 'Jajka L', manufacturer: 'Ferma Zielona', packageSize: 10, packageUnit: 'piece', pricePerPackage: 12, inventoryQuantity: 30 },
  { name: 'Śmietanka 36%', manufacturer: 'Mleczarnia Pod Lasem', packageSize: 500, packageUnit: 'ml', pricePerPackage: 9, inventoryQuantity: 1000 },
  { name: 'Laska wanilii', manufacturer: 'Dom Przypraw', packageSize: 2, packageUnit: 'piece', pricePerPackage: 18, inventoryQuantity: 4 },
];

const recipes = [
  {
    name: 'Kruche ciasto na tartę',
    description: 'Słodkie kruche ciasto na formę do tarty 24 cm',
    portions: 10,
    ingredients: [
      ['Masło 82%', 250, 'g'],
      ['Mąka pszenna typ 450', 300, 'g'],
      ['Cukier drobny', 100, 'g'],
      ['Jajka L', 2, 'piece'],
    ],
    steps: [
      'Posiekaj zimne masło z mąką i cukrem na drobną kruszonkę.',
      'Dodaj jajka i szybko zagnieć ciasto, nie wyrabiając go zbyt długo.',
      'Owiń ciasto folią i schłódź w lodówce przez co najmniej 1 godzinę.',
      'Rozwałkuj na grubość 3 mm, wyłóż formę i podpiecz na ślepo w 170 °C przez 20 minut.',
    ],
  },
  {
    name: 'Krem chantilly',
    description: 'Waniliowa bita śmietana',
    portions: 8,
    ingredients: [
      ['Śmietanka 36%', 0.5, 'l'],
      ['Cukier drobny', 50, 'g'],
      ['Laska wanilii', 1, 'piece'],
    ],
    steps: [
      'Wyskrob ziarenka wanilii do zimnej śmietanki.',
      'Ubij śmietankę z cukrem do uzyskania miękkiej, puszystej konsystencji.',
    ],
  },
];

export async function seed(knex) {
  await knex.transaction(async (trx) => {
    await trx('recipe_cost_history').del();
    await trx('product_price_history').del();
    await trx('change_log').del();
    await trx('recipe_steps').del();
    await trx('recipe_ingredients').del();
    await trx('recipes').del();
    await trx('products').del();

    const inserted = await trx('products').insert(products.map((product) => toProductRow(product))).returning('*');
    for (const product of inserted) {
      await recordProductPriceChange(trx, { product, reason: 'created' });
      await recordChange(trx, { entityType: 'product', entityId: product.id, entityName: product.name, before: null, after: productSnapshot(product) });
    }
    const productIds = new Map(inserted.map((row) => [row.name, row.id]));

    const recipeIds = [];
    for (const recipe of recipes) {
      const [{ id }] = await trx('recipes')
        .insert({ name: recipe.name, description: recipe.description, portions: recipe.portions })
        .returning('id');
      await trx('recipe_ingredients').insert(
        recipe.ingredients.map(([productName, quantity, unit], position) => ({
          recipe_id: id,
          product_id: productIds.get(productName),
          position,
          quantity,
          unit,
        })),
      );
      await trx('recipe_steps').insert(recipe.steps.map((instruction, position) => ({ recipe_id: id, position, instruction })));
      recipeIds.push(id);
    }

    await recalculateRecipeCosts(trx, recipeIds, { reason: 'created' });
    for (const id of recipeIds) {
      const after = await loadRecipeSnapshot(trx, id);
      await recordChange(trx, { entityType: 'recipe', entityId: id, entityName: after.name, before: null, after });
    }
  });
}
