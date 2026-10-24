import { Router } from 'express';
import { idParamsSchema, searchQuerySchema } from '../../lib/schemas.js';
import { validate } from '../../middleware/validate.js';
import { getEntityChanges, getRecipeCostHistory } from '../history/history.service.js';
import { recipeCreateSchema, recipePatchSchema } from './recipes.schema.js';
import * as recipes from './recipes.service.js';

export const recipesRouter = Router();

recipesRouter.get('/', validate({ query: searchQuerySchema }), async (req, res) => {
  res.json({ items: await recipes.listRecipes(req.user.id, req.validated.query) });
});

recipesRouter.get('/:id', validate({ params: idParamsSchema }), async (req, res) => {
  res.json(await recipes.getRecipe(req.user.id, req.validated.params.id));
});

recipesRouter.get('/:id/cost-history', validate({ params: idParamsSchema }), async (req, res) => {
  res.json({ items: await getRecipeCostHistory(req.user.id, req.validated.params.id) });
});

recipesRouter.get('/:id/changes', validate({ params: idParamsSchema }), async (req, res) => {
  res.json({ items: await getEntityChanges(req.user.id, 'recipe', req.validated.params.id) });
});

recipesRouter.post('/', validate({ body: recipeCreateSchema }), async (req, res) => {
  const recipe = await recipes.createRecipe(req.user.id, req.validated.body);
  res.status(201).location(`${req.baseUrl}/${recipe.id}`).json(recipe);
});

recipesRouter.put('/:id', validate({ params: idParamsSchema, body: recipeCreateSchema }), async (req, res) => {
  res.json(await recipes.updateRecipe(req.user.id, req.validated.params.id, req.validated.body));
});

recipesRouter.patch('/:id', validate({ params: idParamsSchema, body: recipePatchSchema }), async (req, res) => {
  res.json(await recipes.updateRecipe(req.user.id, req.validated.params.id, req.validated.body, { partial: true }));
});

recipesRouter.get('/:id/used-in', validate({ params: idParamsSchema }), async (req, res) => {
  res.json({ items: await recipes.listRecipesUsingThisRecipe(req.user.id, req.validated.params.id) });
});

recipesRouter.post('/:id/restore', validate({ params: idParamsSchema }), async (req, res) => {
  res.json(await recipes.restoreRecipe(req.user.id, req.validated.params.id));
});

recipesRouter.delete('/:id', validate({ params: idParamsSchema }), async (req, res) => {
  await recipes.deleteRecipe(req.user.id, req.validated.params.id);
  res.status(204).end();
});
