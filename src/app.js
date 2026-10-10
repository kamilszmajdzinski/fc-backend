import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { changesRouter } from './modules/history/history.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { recipesRouter } from './modules/recipes/recipes.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1/products', productsRouter);
  app.use('/api/v1/recipes', recipesRouter);
  app.use('/api/v1/changes', changesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
