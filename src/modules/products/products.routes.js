import { Router } from 'express';
import { idParamsSchema, searchQuerySchema } from '../../lib/schemas.js';
import { validate } from '../../middleware/validate.js';
import { getEntityChanges, getProductPriceHistory } from '../history/history.service.js';
import { productCreateSchema, productPatchSchema } from './products.schema.js';
import * as products from './products.service.js';

export const productsRouter = Router();

productsRouter.get('/', validate({ query: searchQuerySchema }), async (req, res) => {
  res.json({ items: await products.listProducts(req.user.id, req.validated.query) });
});

productsRouter.get('/:id', validate({ params: idParamsSchema }), async (req, res) => {
  res.json(await products.getProduct(req.user.id, req.validated.params.id));
});

productsRouter.get('/:id/recipes', validate({ params: idParamsSchema }), async (req, res) => {
  res.json({ items: await products.listRecipesUsingProduct(req.user.id, req.validated.params.id) });
});

productsRouter.get('/:id/price-history', validate({ params: idParamsSchema }), async (req, res) => {
  res.json({ items: await getProductPriceHistory(req.user.id, req.validated.params.id) });
});

productsRouter.get('/:id/changes', validate({ params: idParamsSchema }), async (req, res) => {
  res.json({ items: await getEntityChanges(req.user.id, 'product', req.validated.params.id) });
});

productsRouter.post('/', validate({ body: productCreateSchema }), async (req, res) => {
  const product = await products.createProduct(req.user.id, req.validated.body);
  res.status(201).location(`${req.baseUrl}/${product.id}`).json(product);
});

productsRouter.put('/:id', validate({ params: idParamsSchema, body: productCreateSchema }), async (req, res) => {
  res.json(await products.updateProduct(req.user.id, req.validated.params.id, req.validated.body));
});

productsRouter.patch('/:id', validate({ params: idParamsSchema, body: productPatchSchema }), async (req, res) => {
  res.json(await products.updateProduct(req.user.id, req.validated.params.id, req.validated.body, { partial: true }));
});

productsRouter.delete('/:id', validate({ params: idParamsSchema }), async (req, res) => {
  await products.deleteProduct(req.user.id, req.validated.params.id);
  res.status(204).end();
});
