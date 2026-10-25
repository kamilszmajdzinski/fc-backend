import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { requireAuth, supabaseTokenVerifier } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { changesRouter } from './modules/history/history.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { recipesRouter } from './modules/recipes/recipes.routes.js';

// `verifyToken` turns a Bearer token into { id, email } or throws; tests pass their own.
export function createApp({ verifyToken } = {}) {
  verifyToken ??= config.supabaseUrl ? supabaseTokenVerifier(config.supabaseUrl) : null;
  if (!verifyToken) throw new Error('Set SUPABASE_URL so the API can check who is logged in.');

  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  if (config.catalogPublic) app.use('/api/v1/catalog', catalogRouter);
  app.use('/api/v1', requireAuth(verifyToken));
  app.use('/api/v1/products', productsRouter);
  app.use('/api/v1/recipes', recipesRouter);
  app.use('/api/v1/changes', changesRouter);
  if (!config.catalogPublic) app.use('/api/v1/catalog', catalogRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
