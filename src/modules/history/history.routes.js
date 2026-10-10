import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { getChangeFeed } from './history.service.js';

const feedQuerySchema = z.object({
  entityType: z.enum(['product', 'recipe']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});

export const changesRouter = Router();

changesRouter.get('/', validate({ query: feedQuerySchema }), async (req, res) => {
  res.json(await getChangeFeed(req.validated.query));
});
