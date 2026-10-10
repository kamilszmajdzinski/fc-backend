import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from './helpers.js';

after(() => db.destroy());

describe('migrations', () => {
  it('backfills a starting entry for data that existed before history was tracked', async () => {
    // Apply only the first migration and add data the way it existed before history.
    await db.migrate.up({ name: '20261008000000_init.js' });
    const [{ id: productId }] = await db('products')
      .insert({ name: 'Butter', package_size: 200, package_unit: 'g', price_per_package: 8, price_per_unit: 40 })
      .returning('id');
    const [{ id: recipeId }] = await db('recipes').insert({ name: 'Tart', portions: 10, food_cost: 10 }).returning('id');

    await db.migrate.latest();

    const productHistory = await db('product_price_history').where('product_id', productId);
    assert.equal(productHistory.length, 1);
    assert.equal(productHistory[0].reason, 'created');
    assert.equal(productHistory[0].price_per_package, 8);
    assert.equal(productHistory[0].previous_price_per_package, null);

    const recipeHistory = await db('recipe_cost_history').where('recipe_id', recipeId);
    assert.equal(recipeHistory.length, 1);
    assert.equal(recipeHistory[0].food_cost, 10);
    assert.equal(recipeHistory[0].portions, 10);
  });

  it('can all be rolled back and applied again', async () => {
    const tables = ['products', 'recipes', 'product_price_history', 'recipe_cost_history', 'change_log'];

    await db.migrate.rollback({}, true);
    for (const table of tables) assert.equal(await db.schema.hasTable(table), false, table);

    await db.migrate.latest();
    for (const table of tables) assert.equal(await db.schema.hasTable(table), true, table);
  });

  it('rolls back the sell price column without losing recipe data', async () => {
    const [{ id: productId }] = await db('products')
      .insert({ name: 'Butter', package_size: 200, package_unit: 'g', price_per_package: 8, price_per_unit: 40 })
      .returning('id');
    const [{ id: recipeId }] = await db('recipes').insert({ name: 'Tart', portions: 10, food_cost: 10, sell_price: 60 }).returning('id');
    await db('recipe_ingredients').insert({ recipe_id: recipeId, product_id: productId, position: 0, quantity: 250, unit: 'g' });
    await db('recipe_steps').insert({ recipe_id: recipeId, position: 0, instruction: 'Mix' });

    await db.migrate.down({ name: '20261010000000_recipe_sell_price.js' });

    assert.equal(await db.schema.hasColumn('recipes', 'sell_price'), false);
    assert.equal((await db('recipes')).length, 1);
    assert.equal((await db('recipe_ingredients')).length, 1, 'ingredient lines must survive');
    assert.equal((await db('recipe_steps')).length, 1, 'steps must survive');

    await db.migrate.latest();
    assert.equal(await db.schema.hasColumn('recipes', 'sell_price'), true);
  });

  it('rebuilds the history tables without losing rows or links', async () => {
    const softDelete = { name: '20261010120000_recipe_soft_delete.js' };
    await db.migrate.down(softDelete);

    const recipeId = await db('recipes').first('id').then((row) => row.id);
    const [{ id: causeId }] = await db('change_log')
      .insert({ entity_type: 'product', entity_id: 1, entity_name: 'Butter', action: 'updated', changes: '[]' })
      .returning('id');
    const [{ id: effectId }] = await db('change_log')
      .insert({ entity_type: 'recipe', entity_id: recipeId, entity_name: 'Tart', action: 'updated', changes: '[]', cause_change_id: causeId })
      .returning('id');
    await db('recipe_cost_history').insert({ recipe_id: recipeId, reason: 'created', portions: 10, food_cost: 10 });

    await db.migrate.latest();

    assert.equal((await db('change_log').where('id', effectId).first()).cause_change_id, causeId);
    assert.equal((await db('recipe_cost_history').where('recipe_id', recipeId)).length, 1);
    const [{ id: restoredId }] = await db('change_log')
      .insert({ entity_type: 'recipe', entity_id: recipeId, entity_name: 'Tart', action: 'restored', changes: '[]', cause_change_id: effectId })
      .returning('id');
    assert.ok(restoredId > effectId, 'ids continue after the copied rows');
    await db('recipe_cost_history').insert({ recipe_id: recipeId, reason: 'recipe_restored', portions: 10, food_cost: 10 });
    await assert.rejects(db('change_log').insert({ entity_type: 'recipe', entity_id: 1, entity_name: 'X', action: 'bogus', changes: '[]' }));

    const { sql } = await db('sqlite_master').where({ type: 'table', name: 'change_log' }).first('sql');
    assert.ok(!sql.includes('_rebuild'), sql);
    const indexes = await db('sqlite_master').where({ type: 'index', tbl_name: 'change_log' }).pluck('name');
    assert.ok(indexes.includes('change_log_cause_change_id_index'));

    // Deleting the cause still clears the link on the rebuilt table.
    await db('change_log').where('id', causeId).del();
    assert.equal((await db('change_log').where('id', effectId).first()).cause_change_id, null);

    // Rolling back maps the new values to the closest old ones.
    await db.migrate.down(softDelete);
    assert.equal((await db('change_log').where('id', restoredId).first()).action, 'updated');
    assert.equal((await db('recipe_cost_history').where('reason', 'recipe_updated')).length, 1);
    await db.migrate.latest();
  });
});
