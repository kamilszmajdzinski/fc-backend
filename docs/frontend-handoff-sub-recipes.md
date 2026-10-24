# Frontend task: sub-recipes (recipes as ingredients)

The backend now lets a recipe use other recipes as ingredients, e.g. a tart made of a tart base and a cream. This brief lists what the frontend needs to change.

**Full reference:** `C:\Users\kamil.Szmajdzinski\Documents\Development\fc-backend\docs\API.md`. Read the sections "Sub-recipes", "TypeScript types" and "UI flows and gotchas". The types there are exact; copy them, don't retype them from this summary.

Base URL: `http://localhost:3000/api/v1`. Start the backend with `npm run dev` in the backend folder.

## What changed in the API

### 1. Breaking change: recipe ingredient lines

A line is now a product **or** a recipe. Lines returned by `GET /recipes/:id` (and in every recipe response) look like this:

```ts
interface RecipeIngredient {
  id: number;
  type: 'product' | 'recipe';
  productId: number | null;    // null for recipe lines
  productName: string | null;  // null for recipe lines
  recipeId: number | null;     // null for product lines
  recipeName: string | null;   // null for product lines
  name: string;                // productName or recipeName: use this as the label
  quantity: number;
  unit: 'mg' | 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'portion';
  unitPrice: number;
  cost: number;
}
```

Any code that assumes `productId`/`productName` are always set will break. Search for it and switch to `type` and `name`.

### 2. New recipe fields: yield

`Recipe` and `RecipeSummary` (the list items) have `yieldQuantity: number | null` and `yieldUnit: 'mg' | 'g' | 'kg' | 'ml' | 'l' | null`. The yield is what the whole recipe makes, e.g. 550 g. They are accepted in POST/PUT/PATCH and must be set together, or both `null`.

### 3. Sub-recipe ingredient input

In `POST`/`PUT`/`PATCH /recipes`, an ingredient can now be `{ recipeId, quantity, unit }`, next to the existing `{ productId, ... }` and `{ product: {...}, ... }`. Send exactly one of the three; `null` counts as not sent.

Allowed units for a sub-recipe:
- `portion` always, priced at foodCost ÷ portions;
- `mg`/`g`/`kg` or `ml`/`l` only if the sub-recipe has a yield of that kind, priced at foodCost ÷ yield.

Products can't use `portion`.

### 4. New endpoint

`GET /recipes/:id/used-in` returns `{ items: [{ id, name }] }`, the recipes that use this one directly.

### 5. New errors

| Status / code | When | `details` |
|---|---|---|
| `409 RECIPE_IN_USE` | `DELETE /recipes/:id` on a recipe that other recipes use | `{ recipes: [{ id, name }] }` |
| `409 UNIT_CONFLICT` | `PATCH`/`PUT` removes the yield, or changes its kind (g → ml), while others use the recipe by weight or volume | `{ recipes: [{ id, name }] }` |
| `400 VALIDATION_ERROR` | Loop (a recipe using itself, directly or indirectly), unknown or deleted `recipeId`, a unit that doesn't fit, or yield fields not set together | `{ issues: [{ path, message }] }`, e.g. `body.ingredients[2].unit` |

The validation messages are user-friendly enough to show next to the field.

### 6. Side effects to account for

- **Saving a recipe or a product price can change other recipes' costs.** Costs flow up through every level. After saving either, invalidate all cached recipes and recipe lists, not just the edited item.
- **Product updates** return more entries in `recalculatedRecipes`: recipes affected through sub-recipes are now included.
- **Cost history** (`GET /recipes/:id/cost-history`) has a new reason `sub_recipe_changed`. Every entry has a new field `subRecipe: { id, name } | null`.
- **Change log** entries for recipe `ingredients` can contain sub-recipe lines `{ recipeId, recipeName, quantity, unit }` next to product lines `{ productId, productName, quantity, unit }`. The fields `yieldQuantity` and `yieldUnit` are tracked too.
- **Restore** (`POST /recipes/:id/restore`) can report dropped lines with the new reason `recipe_deleted`. Dropped sub-recipe lines have `recipeId`/`recipeName` instead of `productId`/`productName`.

## What to build

1. **Types / API client:** update to the shapes above, copied from `API.md`.
2. **Recipe form:** add optional yield inputs (quantity + unit select with mg/g/kg/ml/l), cleared together.
3. **Ingredient picker:** let the user choose a product **or** a recipe (from `GET /recipes`), e.g. with tabs or grouped results. Exclude the recipe being edited.
4. **Unit select for recipe lines:** offer `portion`, plus the units of the same kind as the sub-recipe's yield. `API.md` has a `subRecipeUnits` helper.
5. **Live cost preview** for recipe lines: use the `subRecipeCost` helper in `API.md`. After saving, show the server's numbers.
6. **Recipe detail:** render lines by `type`, e.g. a recipe icon and a link to the sub-recipe for `type: 'recipe'`.
7. **Delete recipe:** handle `409 RECIPE_IN_USE` by showing the recipes that use it, with links. Optionally call `GET /recipes/:id/used-in` up front.
8. **Yield edits:** handle `409 UNIT_CONFLICT` the same way.
9. **History screens and restore:** handle the new reason, `subRecipe`, sub-recipe lines in change log diffs, and `recipe_deleted`.

## Done when

- A recipe can be created with a sub-recipe line in portions and in grams, and the cost shown matches the API.
- Existing recipes with product lines still display and save correctly; a GET response can be sent back as a PUT unchanged.
- Each new error case shows a clear message, and the user ends up where they can fix it.
- Changing a product price updates the costs of recipes that use it through a sub-recipe, without a manual reload.
