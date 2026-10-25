import { z } from 'zod';
import { unitSchema } from '../../lib/schemas.js';

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

export const SORT_FIELDS = ['name', 'brand', 'price', 'pricePerUnit', 'discountPercent'];

export const catalogIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Expected a catalog id (digits)'),
});

export const catalogProductsQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    // One id or several separated by commas; each covers its whole subtree.
    categoryId: z
      .string()
      .regex(/^\d+(,\d+)*$/, 'Expected category ids separated by commas')
      .transform((value) => value.split(','))
      .optional(),
    // Only kitchen products (those with a kitchenCategory), or one kitchen category.
    kitchen: booleanQuery.optional(),
    kitchenCategory: z.string().trim().min(1).max(100).optional(),
    brand: z.string().trim().min(1).max(200).optional(),
    ean: z.string().trim().regex(/^\d+$/, 'Expected digits').optional(),
    unit: z.enum(['kg', 'l', 'piece']).optional(),
    available: booleanQuery.optional(),
    onSale: booleanQuery.optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    // A field name for ascending, with "-" in front for descending, e.g. -pricePerUnit.
    sort: z.enum([...SORT_FIELDS, ...SORT_FIELDS.map((field) => `-${field}`)]).default('name'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice, {
    message: 'minPrice must not be greater than maxPrice',
    path: ['minPrice'],
  });

export const catalogCategoriesQuerySchema = z.object({
  // Without parentId (and without search) the top-level categories are listed.
  parentId: z.string().regex(/^\d+$/, 'Expected a category id (digits)').optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const suggestionsQuerySchema = z
  .object({
    q: z.string().trim().min(2, 'Type at least 2 characters').max(100),
    // true: add the median catalog price to every suggestion.
    price: booleanQuery.optional(),
    // The package the user is adding, e.g. 500 + g: prices are then per kg and per that package.
    packageSize: z.coerce.number().positive().optional(),
    packageUnit: unitSchema.optional(),
  })
  .refine((query) => query.packageSize === undefined || query.packageUnit !== undefined, {
    message: 'packageSize needs packageUnit',
    path: ['packageUnit'],
  });

export const kitchenCategoriesQuerySchema = z.object({
  available: booleanQuery.optional(),
});
