import { z } from 'zod';
import { unitSchema } from '../../lib/schemas.js';
import { productCreateSchema } from '../products/products.schema.js';

// An ingredient points at an existing product (productId) or creates a new one inline (product).
const ingredientSchema = z
  .object({
    productId: z.number().int().positive().optional(),
    product: productCreateSchema.optional(),
    quantity: z.number().positive(),
    unit: unitSchema,
  })
  .refine((ingredient) => (ingredient.productId === undefined) !== (ingredient.product === undefined), {
    message: 'Provide exactly one of productId (existing product) or product (new product)',
    path: ['productId'],
  });

const recipeFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  portions: z.number().int().positive(),
  // Optional selling price of the whole recipe; null clears it.
  sellPrice: z.number().nonnegative().nullish(),
  ingredients: z.array(ingredientSchema).max(200),
  steps: z.array(z.string().trim().min(1).max(5000)).max(100),
};

// POST and PUT (full replace).
export const recipeCreateSchema = z.object({
  ...recipeFields,
  ingredients: recipeFields.ingredients.default([]),
  steps: recipeFields.steps.default([]),
});

// PATCH: a list that is present replaces the whole stored list.
export const recipePatchSchema = z.object(recipeFields).partial();
