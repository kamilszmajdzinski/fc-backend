import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  catalogCategoriesQuerySchema,
  catalogIdParamsSchema,
  catalogProductsQuerySchema,
  kitchenCategoriesQuerySchema,
  suggestionsQuerySchema,
} from './catalog.schema.js';
import * as catalog from './catalog.service.js';
import { suggestNames } from './catalog.suggest.js';

// Read-only. The data comes from `npm run catalog:import`.
export const catalogRouter = Router();

catalogRouter.get('/', async (req, res) => {
  res.json(await catalog.getCatalogStatus());
});

catalogRouter.get('/products', validate({ query: catalogProductsQuerySchema }), async (req, res) => {
  res.json(await catalog.listCatalogProducts(req.validated.query));
});

catalogRouter.get('/products/:id', validate({ params: catalogIdParamsSchema }), async (req, res) => {
  res.json(await catalog.getCatalogProduct(req.validated.params.id));
});

catalogRouter.get('/categories', validate({ query: catalogCategoriesQuerySchema }), async (req, res) => {
  res.json({ items: await catalog.listCatalogCategories(req.validated.query) });
});

// The built-in kitchen categories with product counts, for browsing the catalog by them.
catalogRouter.get('/kitchen-categories', validate({ query: kitchenCategoriesQuerySchema }), async (req, res) => {
  res.json({ items: await catalog.listKitchenCategories(req.validated.query) });
});

catalogRouter.get('/categories/:id', validate({ params: catalogIdParamsSchema }), async (req, res) => {
  res.json(await catalog.getCatalogCategory(req.validated.params.id));
});

// For the "add product" form: name suggestions for what the user is typing, optionally with prices.
catalogRouter.get('/suggestions', validate({ query: suggestionsQuerySchema }), async (req, res) => {
  res.json(await suggestNames(req.validated.query));
});
