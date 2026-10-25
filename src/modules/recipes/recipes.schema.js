import { z } from 'zod';
import { categorySchema, ingredientUnitSchema, yieldUnitSchema } from '../../lib/schemas.js';
import { productCreateSchema } from '../products/products.schema.js';

// An ingredient is an existing product (productId), a new product created inline (product) or
// another recipe (recipeId). null counts as "not given", so lines from a GET can be sent back.
const ingredientSchema = z
  .object({
    productId: z.number().int().positive().nullish(),
    product: productCreateSchema.nullish(),
    recipeId: z.number().int().positive().nullish(),
    quantity: z.number().positive(),
    unit: ingredientUnitSchema,
  })
  .refine((ingredient) => [ingredient.productId, ingredient.product, ingredient.recipeId].filter((value) => value != null).length === 1, {
    message: 'Provide exactly one of productId (existing product), product (new product) or recipeId (another recipe)',
    path: ['productId'],
  });

const recipeFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  category: categorySchema,
  portions: z.number().int().positive(),
  // Optional selling price of the whole recipe; null clears it.
  sellPrice: z.number().nonnegative().nullish(),
  // Optional yield (e.g. 550 g), needed to use this recipe in other recipes by weight or volume.
  // Both or neither; null clears them.
  yieldQuantity: z.number().positive().nullish(),
  yieldUnit: yieldUnitSchema.nullish(),
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
