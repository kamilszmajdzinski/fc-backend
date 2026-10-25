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
  // Exact category, ignoring letter case.
  category: z.string().trim().min(1).max(100).optional(),
});

// A product's or recipe's category: any text, blank or null for none.
export const categorySchema = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((value) => (value === '' ? null : value));
