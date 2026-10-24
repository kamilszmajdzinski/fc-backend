import { z } from 'zod';
import { INGREDIENT_UNITS, UNIT_NAMES, YIELD_UNITS } from './units.js';

export const unitSchema = z.enum(UNIT_NAMES);
export const ingredientUnitSchema = z.enum(INGREDIENT_UNITS);
export const yieldUnitSchema = z.enum(YIELD_UNITS);

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const searchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
