import { z } from 'zod';
import { categorySchema, unitSchema } from '../../lib/schemas.js';

const productFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  manufacturer: z.string().trim().max(200).nullish(),
  category: categorySchema,
  packageSize: z.number().positive(),
  packageUnit: unitSchema,
  pricePerPackage: z.number().nonnegative().optional(),
  pricePerUnit: z.number().nonnegative().optional(),
  inventoryQuantity: z.number().nonnegative().optional(),
};

// POST, PUT (full replace) and products created inline while saving a recipe.
export const productCreateSchema = z.object(productFields).refine(
  (data) => data.pricePerPackage !== undefined || data.pricePerUnit !== undefined,
  { message: 'Provide pricePerPackage or pricePerUnit', path: ['pricePerPackage'] },
);

export const productPatchSchema = z.object(productFields).partial();

export const productSuggestionQuerySchema = z.object({
  name: z.string().trim().min(2, 'Type at least 2 characters').max(200),
});
