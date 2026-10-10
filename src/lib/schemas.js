import { z } from 'zod';
import { UNIT_NAMES } from './units.js';

export const unitSchema = z.enum(UNIT_NAMES);

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const searchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
