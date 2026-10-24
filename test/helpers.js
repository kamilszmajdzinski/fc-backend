import { generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import db from '../src/db/knex.js';
import { tokenVerifier } from '../src/middleware/auth.js';

export { db };

// Tokens are signed like Supabase Auth signs them, with a key pair made for the test run.
const ISSUER = 'https://test-project.supabase.co/auth/v1';
const { publicKey, privateKey } = await generateKeyPair('ES256');
export const verifyToken = tokenVerifier({ issuer: ISSUER, keys: publicKey });

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

export async function signToken(userId, { issuer = ISSUER, audience = 'authenticated', expiresIn = '1h', key = privateKey } = {}) {
  return new SignJWT({ email: `${userId}@example.com`, role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

let app;

// Each test file runs in its own process, so each one gets its own in-memory database.
// Returns a client logged in as USER_A; use `authAs` for anyone else.
export async function setupApi() {
  await db.migrate.latest();
  app = createApp({ verifyToken });
  return authAs(USER_A);
}

// A supertest client whose requests all carry `userId`'s access token.
export async function authAs(userId) {
  const header = `Bearer ${await signToken(userId)}`;
  const agent = request(app);
  return Object.fromEntries(
    ['get', 'post', 'put', 'patch', 'delete'].map((method) => [method, (url) => agent[method](url).set('Authorization', header)]),
  );
}

// A supertest client without any token.
export function anonymous() {
  return request(app);
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
