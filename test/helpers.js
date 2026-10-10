import request from 'supertest';
import { createApp } from '../src/app.js';
import db from '../src/db/knex.js';

export { db };

// Each test file runs in its own process, so each one gets its own in-memory database.
export async function setupApi() {
  await db.migrate.latest();
  return request(createApp());
}

export async function resetDatabase() {
  await db('change_log').del();
  await db('recipe_cost_history').del();
  await db('product_price_history').del();
  await db('recipe_steps').del();
  await db('recipe_ingredients').del();
  await db('recipes').del();
  await db('products').del();
}

export const sampleProducts = {
  butter: { name: 'Butter 82%', manufacturer: 'Dairy Co.', packageSize: 200, packageUnit: 'g', pricePerPackage: 8, inventoryQuantity: 1000 },
  flour: { name: 'Wheat flour', manufacturer: 'Mill & Co.', packageSize: 1, packageUnit: 'kg', pricePerPackage: 3 },
  eggs: { name: 'Eggs L', manufacturer: 'Farm Fresh', packageSize: 10, packageUnit: 'piece', pricePerPackage: 12 },
};

export async function createProduct(api, data) {
  const res = await api.post('/api/v1/products').send(data).expect(201);
  return res.body;
}
