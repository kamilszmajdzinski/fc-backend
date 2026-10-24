# API reference for the frontend

Everything a web or mobile client needs to talk to the pastry chef backend (step 1: products, recipes, food cost).

- [Basics](#basics)
- [TypeScript types](#typescript-types)
- [Units](#units)
- [Products](#products): [list](#list-products) · [get](#get-a-product) · [recipes using it](#recipes-that-use-a-product) · [create](#create-a-product) · [replace](#replace-a-product) · [update](#update-a-product) · [delete](#delete-a-product)
- [Recipes](#recipes): [list](#list-recipes) · [get](#get-a-recipe) · [create](#create-a-recipe) · [replace](#replace-a-recipe) · [update](#update-a-recipe) · [delete](#delete-a-recipe) · [restore](#restore-a-recipe) · [sub-recipes](#sub-recipes) · [used in](#recipes-that-use-a-recipe)
- [History](#history): [price and cost history](#price-and-cost-history) · [product price history](#product-price-history) · [recipe cost history](#recipe-cost-history) · [change log](#change-log) · [product and recipe change log](#product-and-recipe-change-log) · [change feed](#change-feed)
- [Errors](#errors)
- [UI flows and gotchas](#ui-flows-and-gotchas)
- [Not supported yet](#not-supported-yet)

## Basics

| | |
|---|---|
| Base URL (local) | `http://localhost:3000/api/v1` |
| Health check | `GET http://localhost:3000/health` → `{ "status": "ok" }` |
| Format | JSON in and out, camelCase field names. Send `Content-Type: application/json` on every request with a body, or the body is ignored and you get validation errors. |
| Auth | Every `/api/v1` request needs `Authorization: Bearer <access token>` from Supabase Auth (Google login): `(await supabase.auth.getSession()).data.session.access_token`. Without a valid token: `401 UNAUTHORIZED`. `/health` is public. |
| Data | Each user has their own products, recipes and history. Another user's ids behave exactly like ids that don't exist (`404`, or "does not exist" when used as an ingredient). |
| CORS | Allowed origins come from the backend's `CORS_ORIGIN` setting (default `*`). |
| IDs | Positive integers. |
| Dates | ISO 8601 strings in UTC, e.g. `"2026-10-08T09:09:27.000Z"`. |
| Money | Plain numbers rounded to 2 decimals. There is no currency field; the app decides the currency. `unitPrice` on recipe ingredients is rounded to 6 decimals because prices per g or mg are tiny. |
| Lists | Always `{ "items": [...] }`, sorted by name. No pagination yet. |
| Unknown fields | Ignored, so you can send an object you got from a GET back in a PUT. |
| Request body limit | 1 MB |

Status codes used:

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created. The `Location` header holds the new resource's path, e.g. `/api/v1/recipes/3`. |
| 204 | Deleted. Empty body. |
| 400 | Invalid request. See [Errors](#errors). |
| 401 | Missing, invalid or expired access token. Log in again. |
| 404 | Unknown id or route. |
| 409 | The action conflicts with existing recipes. |
| 500 | Server error. |

## TypeScript types

Copy these into the frontend. They describe exactly what the API sends and accepts.

```ts
export type Unit = 'mg' | 'g' | 'kg' | 'ml' | 'l' | 'piece';   // product units
export type IngredientUnit = Unit | 'portion';                  // 'portion' only for sub-recipes
export type YieldUnit = 'mg' | 'g' | 'kg' | 'ml' | 'l';         // a recipe's yield
export type PricingUnit = 'kg' | 'l' | 'piece';

export interface ListResponse<T> {
  items: T[];
}

// ---------- Products ----------

export interface Product {
  id: number;
  name: string;
  description: string | null;
  manufacturer: string | null;
  packageSize: number;        // e.g. 200
  packageUnit: Unit;          // e.g. 'g'  -> "package of 200 g"
  pricePerPackage: number;    // e.g. 8
  pricePerUnit: number;       // price per pricingUnit, e.g. 40
  pricingUnit: PricingUnit;   // 'kg' for mg/g/kg, 'l' for ml/l, 'piece' for piece
  inventoryQuantity: number;  // how much the user has, in packageUnit
  createdAt: string;
  updatedAt: string;
}

// POST /products, PUT /products/:id, and inline products inside a recipe.
// Send pricePerPackage OR pricePerUnit (at least one).
export interface ProductInput {
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  packageSize: number;
  packageUnit: Unit;
  pricePerPackage?: number;
  pricePerUnit?: number;
  inventoryQuantity?: number; // default 0
}

// PATCH /products/:id - every field optional.
export type ProductPatch = Partial<ProductInput>;

export interface RecipeRef {
  id: number;
  name: string;
}

export interface RecalculatedRecipe {
  id: number;
  name: string;
  previousFoodCost: number;
  foodCost: number;
}

// Response of PUT and PATCH /products/:id
export interface ProductUpdateResult {
  product: Product;
  recalculatedRecipes: RecalculatedRecipe[]; // empty if the price did not change
}

// ---------- Recipes ----------

export interface RecipeSummary {
  id: number;
  name: string;
  description: string | null;
  portions: number;
  foodCost: number;
  costPerPortion: number;
  sellPrice: number | null;
  yieldQuantity: number | null;
  yieldUnit: YieldUnit | null;
  ingredientCount: number;
  updatedAt: string;
}

// A line is a product or another recipe (a sub-recipe), see "Sub-recipes".
export interface RecipeIngredient {
  id: number;                 // changes every time the ingredient list is saved - don't use as a stable key
  type: 'product' | 'recipe';
  productId: number | null;   // set when type is 'product'
  productName: string | null; // always the product's current name
  recipeId: number | null;    // set when type is 'recipe'
  recipeName: string | null;  // always the sub-recipe's current name
  name: string;               // productName or recipeName
  quantity: number;
  unit: IngredientUnit;
  unitPrice: number;          // price of 1 `unit`, e.g. per g, or per portion of a sub-recipe
  cost: number;               // quantity * unitPrice
}

export interface Recipe {
  id: number;
  name: string;
  description: string | null;
  portions: number;
  foodCost: number;         // sum of ingredient costs
  costPerPortion: number;   // foodCost / portions
  sellPrice: number | null; // selling price of the whole recipe, if set
  yieldQuantity: number | null; // what the whole recipe makes, e.g. 550 ...
  yieldUnit: YieldUnit | null;  // ... g. Needed to use it in other recipes by weight or volume.
  ingredients: RecipeIngredient[];
  steps: string[];
  createdAt: string;
  updatedAt: string;
}

// An ingredient is an existing product, a new product created on save, or another recipe.
export type IngredientInput =
  | { productId: number; quantity: number; unit: Unit }
  | { product: ProductInput; quantity: number; unit: Unit }
  | { recipeId: number; quantity: number; unit: IngredientUnit };

// POST /recipes, PUT /recipes/:id
export interface RecipeInput {
  name: string;
  description?: string | null;
  portions: number;
  sellPrice?: number | null;       // default null
  yieldQuantity?: number | null;   // default null; set together with yieldUnit
  yieldUnit?: YieldUnit | null;    // default null
  ingredients?: IngredientInput[]; // default []
  steps?: string[];                // default []
}

// PATCH /recipes/:id - every field optional; a list you send replaces the stored list.
export type RecipePatch = Partial<RecipeInput>;

// ---------- History ----------

export interface PriceSnapshot {
  packageSize: number;
  packageUnit: Unit;
  pricePerPackage: number;
  pricePerUnit: number;
  pricingUnit: PricingUnit;
}

// GET /products/:id/price-history - values after the change, plus `previous`.
export interface ProductPriceChange extends PriceSnapshot {
  id: number;
  changedAt: string;
  reason: 'created' | 'updated';
  previous: PriceSnapshot | null; // null when reason is 'created'
  affectedRecipes: {              // recipes whose food cost changed because of this change
    id: number;
    name: string;
    previousFoodCost: number | null;
    foodCost: number;
  }[];
}

export interface CostSnapshot {
  portions: number;
  foodCost: number;
  costPerPortion: number;
}

// GET /recipes/:id/cost-history - values after the change, plus `previous`.
export interface RecipeCostChange extends CostSnapshot {
  id: number;
  changedAt: string;
  reason: 'created' | 'recipe_updated' | 'recipe_restored' | 'product_price_changed' | 'sub_recipe_changed';
  previous: CostSnapshot | null; // null for the first entry
  subRecipe: { id: number; name: string } | null; // the sub-recipe that passed the change on, if any
  cause: {                       // set when reason is 'product_price_changed', otherwise null
    priceChangeId: number;       // id of the matching entry in the product's price history
    productId: number | null;    // null if the product has been deleted since
    productName: string;
    previousPricePerPackage: number | null;
    pricePerPackage: number;
    previousPricePerUnit: number | null;
    pricePerUnit: number;
    pricingUnit: PricingUnit;
  } | null;
}

// ---------- Change log ----------

export type ProductField =
  | 'name' | 'description' | 'manufacturer' | 'packageSize' | 'packageUnit'
  | 'pricePerPackage' | 'pricePerUnit' | 'inventoryQuantity';
export type RecipeField =
  | 'name' | 'description' | 'portions' | 'sellPrice' | 'yieldQuantity' | 'yieldUnit'
  | 'ingredients' | 'steps' | 'foodCost';

// One line of a recipe's ingredient list as it was at the time of the change.
export type IngredientSnapshot =
  | { productId: number; productName: string; quantity: number; unit: Unit }
  | { recipeId: number; recipeName: string; quantity: number; unit: IngredientUnit };

export interface FieldChange {
  field: ProductField | RecipeField;
  from: unknown; // null for 'created'. Type depends on the field, see "Change log".
  to: unknown;   // null for 'deleted'
}

export interface ChangeEntry {
  id: number;
  changedAt: string;
  entityType: 'product' | 'recipe';
  entityId: number;
  entityName: string; // name right after the change (the last name, for 'deleted')
  action: 'created' | 'updated' | 'deleted' | 'restored';
  changes: FieldChange[];
}

// GET /products/:id/changes, GET /recipes/:id/changes, GET /changes
export interface ChangeLogEntry extends ChangeEntry {
  triggeredBy: ChangeEntry | null; // the change that caused this one, e.g. a product price change
  triggered: ChangeEntry[];        // changes this one caused, e.g. recipe food cost changes
}

// GET /changes
export interface ChangeFeed {
  items: ChangeLogEntry[];
  nextBefore: number | null; // pass as ?before= to get the next page; null when there is no more
}

// ---------- Errors ----------

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'PRODUCT_IN_USE'
  | 'UNIT_CONFLICT'
  | 'RECIPE_NOT_DELETED'
  | 'RECIPE_IN_USE'
  | 'INTERNAL_ERROR';

export interface ValidationIssue {
  path: string;    // e.g. 'body.name', 'body.ingredients[1].unit', 'params.id'
  message: string;
}

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: { issues: ValidationIssue[] } | { recipes: RecipeRef[] };
  };
}
```

## Units

| Unit | Kind | In base unit | Price per unit is shown per |
|---|---|---|---|
| `mg` | weight | 0.001 g | kg |
| `g` | weight | 1 g | kg |
| `kg` | weight | 1000 g | kg |
| `ml` | volume | 1 ml | l |
| `l` | volume | 1000 ml | l |
| `piece` | count | 1 piece | piece |

**Rule:** a recipe can only use a product in a unit of the same kind as its `packageUnit`. Butter bought in `g` can be used in `mg`, `g` or `kg`, but never in `ml` or `piece`. Converting between weight and volume is not supported.

**Sub-recipes** use one more unit, `portion`. They can also be used in units of the same kind as their yield, if they have one. See [Sub-recipes](#sub-recipes).

Helpers you can reuse in the frontend. They match the backend's maths exactly:

```ts
const UNITS: Record<Unit, { kind: 'weight' | 'volume' | 'count'; factor: number }> = {
  mg: { kind: 'weight', factor: 0.001 },
  g: { kind: 'weight', factor: 1 },
  kg: { kind: 'weight', factor: 1000 },
  ml: { kind: 'volume', factor: 1 },
  l: { kind: 'volume', factor: 1000 },
  piece: { kind: 'count', factor: 1 },
};

// Units to offer in the ingredient's unit picker.
export function compatibleUnits(packageUnit: Unit): Unit[] {
  return (Object.keys(UNITS) as Unit[]).filter((u) => UNITS[u].kind === UNITS[packageUnit].kind);
}

export function convert(quantity: number, from: Unit, to: Unit): number {
  return (quantity * UNITS[from].factor) / UNITS[to].factor;
}

// Live cost preview in the recipe editor, before saving.
export function ingredientCost(product: Product, quantity: number, unit: Unit): number {
  const unitPrice = product.pricePerPackage / convert(product.packageSize, product.packageUnit, unit);
  return quantity * unitPrice;
}

// Units to offer when the ingredient is another recipe.
export function subRecipeUnits(recipe: Recipe | RecipeSummary): IngredientUnit[] {
  return ['portion', ...(recipe.yieldUnit ? compatibleUnits(recipe.yieldUnit) : [])];
}

// Live cost preview for a sub-recipe line.
export function subRecipeCost(recipe: Recipe | RecipeSummary, quantity: number, unit: IngredientUnit): number {
  const unitPrice = unit === 'portion'
    ? recipe.foodCost / recipe.portions
    : recipe.foodCost / convert(recipe.yieldQuantity!, recipe.yieldUnit!, unit);
  return quantity * unitPrice;
}
```

The preview can differ from the saved value by a cent, because `pricePerPackage` in API responses is already rounded. After saving, always show the values from the response.

---

## Products

### List products

`GET /products?search=butter`

| Query | Type | Notes |
|---|---|---|
| `search` | string, optional, max 200 | Case-insensitive match anywhere in the name **or** the manufacturer. |

Response `200`: `ListResponse<Product>`

```json
{
  "items": [
    {
      "id": 1,
      "name": "Butter 82%",
      "description": "Unsalted butter",
      "manufacturer": "Dairy Co.",
      "packageSize": 200,
      "packageUnit": "g",
      "pricePerPackage": 8,
      "pricePerUnit": 40,
      "pricingUnit": "kg",
      "inventoryQuantity": 1000,
      "createdAt": "2026-10-08T09:09:27.000Z",
      "updatedAt": "2026-10-08T09:09:27.000Z"
    }
  ]
}
```

### Get a product

`GET /products/:id`

Response `200`: `Product`. Errors: `404 NOT_FOUND`.

### Recipes that use a product

`GET /products/:id/recipes`

Useful for "Used in 3 recipes" in the product details screen, or before deleting a product. Deleted recipes are not included.

Response `200`: `ListResponse<RecipeRef>`

```json
{ "items": [{ "id": 1, "name": "Shortcrust tart base" }] }
```

Errors: `404 NOT_FOUND`.

### Create a product

`POST /products` with body `ProductInput`

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 1–200 characters (trimmed) |
| `description` | string \| null | no | max 5000 |
| `manufacturer` | string \| null | no | max 200 |
| `packageSize` | number | yes | > 0. How much is in one package, e.g. `200`. |
| `packageUnit` | `Unit` | yes | Unit of `packageSize`, e.g. `"g"`. |
| `pricePerPackage` | number | one of the two | ≥ 0 |
| `pricePerUnit` | number | one of the two | ≥ 0. Price per kg, l or piece, depending on `packageUnit`. |
| `inventoryQuantity` | number | no | ≥ 0, default `0`. In `packageUnit`. |

**Prices:** send whichever price the user typed, and the API calculates the other. If you send both, `pricePerPackage` wins and `pricePerUnit` is recalculated from it.

```json
{
  "name": "Butter 82%",
  "manufacturer": "Dairy Co.",
  "packageSize": 200,
  "packageUnit": "g",
  "pricePerPackage": 8,
  "inventoryQuantity": 1000
}
```

Response `201`: `Product`, with `pricePerUnit: 40` and `pricingUnit: "kg"` filled in. Errors: `400 VALIDATION_ERROR`.

### Replace a product

`PUT /products/:id` with body `ProductInput` (same rules as create)

Replaces **every** field. Any optional field you leave out is reset: `description` and `manufacturer` become `null` and `inventoryQuantity` becomes `0`. For edit forms, prefer [PATCH](#update-a-product).

Response `200`: `ProductUpdateResult`. Errors: `400`, `404`, `409 UNIT_CONFLICT`.

### Update a product

`PATCH /products/:id` with body `ProductPatch`. Send only the fields that changed.

```json
{ "pricePerPackage": 10 }
```

How fields combine with what is already stored:

| You send | Result |
|---|---|
| `pricePerPackage` | `pricePerUnit` is recalculated. |
| `pricePerUnit` only | `pricePerPackage` is recalculated from it. |
| `packageSize` and/or `packageUnit` only | The package price stays the same and `pricePerUnit` is recalculated. |
| `description: null` | Clears the description. The same applies to `manufacturer`. |
| `inventoryQuantity` | Just updates the stock. Recipes are not touched. |

**Recipe recalculation.** If the change affects the product's price (`pricePerPackage`, `pricePerUnit`, `packageSize` or `packageUnit`), every recipe using the product is recalculated in the same request, including recipes that use it through [sub-recipes](#sub-recipes). Those recipes come back in `recalculatedRecipes`, sorted by name. Changing only the name, description, manufacturer or inventory recalculates nothing (`recalculatedRecipes: []`). A renamed product shows its new name in recipes straight away.

Response `200`: `ProductUpdateResult`

```json
{
  "product": {
    "id": 5,
    "name": "Cream 36%",
    "description": null,
    "manufacturer": "Dairy Co.",
    "packageSize": 500,
    "packageUnit": "ml",
    "pricePerPackage": 10,
    "pricePerUnit": 20,
    "pricingUnit": "l",
    "inventoryQuantity": 1000,
    "createdAt": "2026-10-08T09:09:27.000Z",
    "updatedAt": "2026-10-08T09:12:42.000Z"
  },
  "recalculatedRecipes": [
    { "id": 2, "name": "Chantilly cream", "previousFoodCost": 18.23, "foodCost": 19.23 },
    { "id": 3, "name": "Chocolate ganache", "previousFoodCost": 15.6, "foodCost": 16 }
  ]
}
```

Errors:
- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`
- `409 UNIT_CONFLICT`: you changed `packageUnit` to a different kind (e.g. `g` → `piece`) while recipes use the product in the old kind. Nothing is saved. Changing within the same kind (`g` → `kg`) is always allowed.

  ```json
  {
    "error": {
      "code": "UNIT_CONFLICT",
      "message": "\"Butter 82%\" is used in recipes with units that do not fit \"piece\". Change those recipes first.",
      "details": { "recipes": [{ "id": 1, "name": "Shortcrust tart base" }] }
    }
  }
  ```

### Delete a product

`DELETE /products/:id`

Response `204` with no body. The deletion is recorded in the [change log](#change-log), which stays readable.

Errors:
- `404 NOT_FOUND`
- `409 PRODUCT_IN_USE`: at least one recipe uses the product. Nothing is deleted. The user has to remove it from those recipes, or delete the recipes, first.

Deleted recipes don't block the deletion. Their lines with this product are removed, and [restoring](#restore-a-recipe) such a recipe reports those lines in `droppedIngredients`.

  ```json
  {
    "error": {
      "code": "PRODUCT_IN_USE",
      "message": "\"Butter 82%\" is used in 1 recipe(s). Remove it from them first.",
      "details": { "recipes": [{ "id": 1, "name": "Shortcrust tart base" }] }
    }
  }
  ```

---

## Recipes

### List recipes

`GET /recipes?search=tart`

| Query | Type | Notes |
|---|---|---|
| `search` | string, optional, max 200 | Case-insensitive match anywhere in the recipe name. |

Response `200`: `ListResponse<RecipeSummary>`. Summaries don't include ingredients or steps.

```json
{
  "items": [
    {
      "id": 2,
      "name": "Chantilly cream",
      "description": "Vanilla whipped cream",
      "portions": 8,
      "foodCost": 18.23,
      "costPerPortion": 2.28,
      "sellPrice": null,
      "ingredientCount": 3,
      "updatedAt": "2026-10-08T09:09:27.000Z"
    }
  ]
}
```

### Get a recipe

`GET /recipes/:id`

Response `200`: `Recipe` (example under [Create a recipe](#create-a-recipe)). Errors: `404 NOT_FOUND`.

### Create a recipe

`POST /recipes` with body `RecipeInput`

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 1–200 characters (trimmed) |
| `description` | string \| null | no | max 5000 |
| `portions` | integer | yes | ≥ 1 |
| `sellPrice` | number \| null | no | ≥ 0, default `null`. Selling price of the **whole recipe** (the same scope as `foodCost`). |
| `yieldQuantity` | number \| null | no | > 0, default `null`. What the whole recipe makes, e.g. `550`. Set together with `yieldUnit`. |
| `yieldUnit` | `YieldUnit` \| null | no | `mg`, `g`, `kg`, `ml` or `l`, default `null`. Lets other recipes use this one by weight or volume. |
| `ingredients` | `IngredientInput[]` | no | max 200, default `[]`. Order is kept. |
| `steps` | string[] | no | max 100, each 1–5000 characters, default `[]`. Order is kept. |

Each ingredient:

| Field | Type | Rules |
|---|---|---|
| `productId` | integer | An existing product. |
| `product` | `ProductInput` | A new product, created when the recipe is saved. Same rules as [Create a product](#create-a-product). |
| `recipeId` | integer | Another recipe, used as a [sub-recipe](#sub-recipes). |
| `quantity` | number | > 0 |
| `unit` | `IngredientUnit` | For products: the same kind as the product's `packageUnit` (see [Units](#units)). For sub-recipes: `portion`, or the same kind as the sub-recipe's `yieldUnit`. |

Send exactly one of `productId`, `product` and `recipeId`. `null` counts as not sent, so lines from a GET can be sent back as they are.

The same product or sub-recipe may appear more than once, for example butter in both the dough and the crumble.

The whole save is one transaction. If any ingredient is invalid, nothing is saved, including new inline products.

```json
{
  "name": "Chocolate ganache",
  "description": "For tart filling",
  "portions": 6,
  "sellPrice": 45,
  "ingredients": [
    { "productId": 5, "quantity": 200, "unit": "ml" },
    {
      "product": {
        "name": "Dark chocolate 70%",
        "manufacturer": "Cocoa Co.",
        "packageSize": 1,
        "packageUnit": "kg",
        "pricePerPackage": 60
      },
      "quantity": 200,
      "unit": "g"
    }
  ],
  "steps": ["Bring the cream to a simmer.", "Pour over the chocolate and emulsify."]
}
```

Response `201` with `Location: /api/v1/recipes/3`, body `Recipe`:

```json
{
  "id": 3,
  "name": "Chocolate ganache",
  "description": "For tart filling",
  "portions": 6,
  "foodCost": 15.6,
  "costPerPortion": 2.6,
  "sellPrice": 45,
  "yieldQuantity": null,
  "yieldUnit": null,
  "ingredients": [
    {
      "id": 8, "type": "product", "productId": 5, "productName": "Cream 36%", "recipeId": null, "recipeName": null,
      "name": "Cream 36%", "quantity": 200, "unit": "ml", "unitPrice": 0.018, "cost": 3.6
    },
    {
      "id": 9, "type": "product", "productId": 7, "productName": "Dark chocolate 70%", "recipeId": null, "recipeName": null,
      "name": "Dark chocolate 70%", "quantity": 200, "unit": "g", "unitPrice": 0.06, "cost": 12
    }
  ],
  "steps": ["Bring the cream to a simmer.", "Pour over the chocolate and emulsify."],
  "createdAt": "2026-10-08T09:12:42.000Z",
  "updatedAt": "2026-10-08T09:12:42.000Z"
}
```

The new product's id is in `ingredients[1].productId`. Refresh your product list after saving a recipe that created products.

Errors: `400 VALIDATION_ERROR`, for example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "issues": [
        { "path": "body.ingredients[0].unit", "message": "\"Butter 82%\" is measured in g, so the unit must be one of: mg, g, kg" }
      ]
    }
  }
}
```

Other ingredient errors you may see:

| Path | Message |
|---|---|
| `body.ingredients[i].productId` | `Product 99 does not exist` |
| `body.ingredients[i].productId` | `Provide exactly one of productId (existing product), product (new product) or recipeId (another recipe)` |
| `body.ingredients[i].recipeId` | `Recipe 99 does not exist` (also for deleted recipes) |
| `body.ingredients[i].recipeId` | `A recipe cannot use itself` |
| `body.ingredients[i].recipeId` | `"Tart" already uses this recipe, so this recipe cannot use it` |
| `body.ingredients[i].unit` | `"Krem chantilly" yields 550 g, so the unit must be one of: portion, mg, g, kg` |
| `body.ingredients[i].unit` | `"Glaze" has no yield, so it can only be used in portions` |
| `body.yieldUnit` | `Set yieldQuantity and yieldUnit together, or neither` |
| `body.ingredients[i].product.pricePerPackage` | `Provide pricePerPackage or pricePerUnit` |
| `body.ingredients[i].quantity` | `Too small: expected number to be >0` |

### Replace a recipe

`PUT /recipes/:id` with body `RecipeInput` (same rules as create)

Replaces everything. If you leave out `description`, `sellPrice`, `yieldQuantity`/`yieldUnit`, `ingredients` or `steps`, they become `null`, `null`, `null`, `[]` and `[]`. A `Recipe` from a GET can be sent back as is: extra fields such as `id`, `productName` and `cost` are ignored.

Response `200`: `Recipe`. Errors: `400`, `404`, `409 UNIT_CONFLICT` (see below).

### Update a recipe

`PATCH /recipes/:id` with body `RecipePatch`

- Fields you don't send stay unchanged. Send `null` to clear `description` or `sellPrice`, and `null` for both `yieldQuantity` and `yieldUnit` to remove the yield.
- `ingredients` and `steps` are lists. If you send one, it **replaces the whole stored list**, so always send the complete list, not just the changed line.
- Food cost is recalculated on every save. If other recipes use this one, they are recalculated too (see [Sub-recipes](#sub-recipes)).

```json
{ "portions": 12 }
```

Response `200`: `Recipe`. Errors:
- `400`
- `404`
- `409 UNIT_CONFLICT`: the yield was removed or changed to another kind (e.g. `g` → `ml`) while other recipes use this one by weight or volume. `details.recipes` lists them. A change within the same kind (`300 g` → `0.3 kg`) is always allowed.

### Delete a recipe

`DELETE /recipes/:id`

Response `204` with no body. Errors:
- `404 NOT_FOUND`, also when the recipe is already deleted.
- `409 RECIPE_IN_USE`: other recipes use this one as a sub-recipe. Nothing is deleted. `details.recipes` lists them, and the user has to remove it from those recipes, or delete them, first. Deleted recipes don't count.

This is a **soft delete**. The recipe keeps its ingredients, steps and cost history and can be [restored](#restore-a-recipe). While deleted, it behaves as if it doesn't exist:
- `GET`, `PUT`, `PATCH` and `DELETE /recipes/:id` and `GET /recipes/:id/cost-history` return `404`, and `GET /recipes` doesn't list it.
- It doesn't count as using its products. It isn't listed in `GET /products/:id/recipes`, it doesn't block deleting a product or changing its unit kind, and its food cost isn't recalculated when prices change.

Only `GET /recipes/:id/changes` and `POST /recipes/:id/restore` still work. The deletion is recorded in the [change log](#change-log).

### Restore a recipe

`POST /recipes/:id/restore` (no body)

Brings back a deleted recipe with the same id, ingredients, steps and cost history, and recalculates its food cost with current product prices.

Ingredient lines that can no longer be used are left out and reported in `droppedIngredients`:

| `reason` | When |
|---|---|
| `product_deleted` | The product was deleted while the recipe was deleted. |
| `recipe_deleted` | The sub-recipe was deleted while the recipe was deleted. |
| `unit_incompatible` | The product's unit changed to another kind (e.g. `g` → `piece`), or the sub-recipe's yield was removed or changed to another kind, while the recipe was deleted. |

Response `200`: `RestoreRecipeResult`

```ts
// A product line ({ productId, productName, ... }) or a sub-recipe line ({ recipeId, recipeName, ... }).
// The name is the one from when the recipe was deleted (or the current one, for unit_incompatible).
export type DroppedIngredient = IngredientSnapshot & {
  reason: 'product_deleted' | 'recipe_deleted' | 'unit_incompatible';
};

export interface RestoreRecipeResult {
  recipe: Recipe;
  droppedIngredients: DroppedIngredient[]; // usually empty
}
```

```json
{
  "recipe": { "id": 1, "name": "Shortcrust tart base", "foodCost": 3.3, "...": "..." },
  "droppedIngredients": [
    { "productId": 1, "productName": "Butter 82%", "quantity": 250, "unit": "g", "reason": "product_deleted" }
  ]
}
```

The restore is logged in the change log with `action: 'restored'`. Its `changes` show what is different from when the recipe was deleted, e.g. dropped ingredients and a new `foodCost`, and are empty if nothing changed. If the food cost changed, the cost history gets a `recipe_restored` entry.

Errors:
- `404 NOT_FOUND`: no such recipe. Recipes deleted before soft delete was added are gone for good.
- `409 RECIPE_NOT_DELETED`: the recipe isn't deleted.

### Sub-recipes

A recipe can use other recipes as ingredients, e.g. a tart made of a tart base and a cream. Add the line with `recipeId` instead of `productId`. Sub-recipes can contain sub-recipes themselves, to any depth.

**How a sub-recipe is measured**

| Unit | Price of one unit | Example ("Krem chantilly": food cost 18.23, 8 portions, yield 550 g) |
|---|---|---|
| `portion` | `foodCost / portions` | 2 portions = 2 × 2.28 = 4.56 |
| same kind as `yieldUnit` | `foodCost / yield` | 300 g = 18.23 / 550 g × 300 g = 9.94 |

Every recipe can be used in portions. Using it by weight or volume needs its yield: what the whole recipe makes, weighed or measured by the chef (e.g. `yieldQuantity: 550, yieldUnit: "g"`). The yield is never calculated from the ingredients, because cooking changes weight and ingredients can mix grams with millilitres.

```json
{
  "name": "Tarta z kremem chantilly",
  "portions": 10,
  "ingredients": [
    { "recipeId": 1, "quantity": 10, "unit": "portion" },
    { "recipeId": 2, "quantity": 300, "unit": "g" }
  ]
}
```

A sub-recipe line in the response:

```json
{
  "id": 14, "type": "recipe", "productId": null, "productName": null, "recipeId": 2, "recipeName": "Krem chantilly",
  "name": "Krem chantilly", "quantity": 300, "unit": "g", "unitPrice": 0.033136, "cost": 9.94
}
```

**Costs flow up.** When anything changes the cost of a sub-recipe, every recipe that uses it is recalculated in the same request, level by level. That includes a product price, the sub-recipe's ingredients, its portions or its yield. A recipe that uses a product both directly and through a sub-recipe is recalculated once, with both changes.
- `PUT`/`PATCH /products/:id` returns every recalculated recipe in `recalculatedRecipes`: the ones using the product directly, and the ones above them whose cost changed.
- Cost history: recipes above the first level get reason `product_price_changed` (with the product in `cause`) when a product price started it, otherwise `sub_recipe_changed`. `subRecipe` names the sub-recipe the change came through.
- Change log: each level's `foodCost` entry points to the level below in `triggeredBy`, so you can follow product → cream → tart.

**Rules**
- **No loops.** A recipe can't use itself, directly or through other recipes. The API returns `400`.
- **In-use recipes can't be deleted.** You get `409 RECIPE_IN_USE`, the same as deleting a product in use.
- **Yield changes must still fit.** Removing the yield, or changing its kind, while recipes use the sub-recipe by weight or volume returns `409 UNIT_CONFLICT`.
- **Deleted recipes can't be added** as sub-recipes. Restoring a recipe whose sub-recipe was deleted meanwhile drops that line (`recipe_deleted`).
- **No inline creation.** You can't create a sub-recipe while saving another recipe. Create it first, then use its id.

### Recipes that use a recipe

`GET /recipes/:id/used-in`

Response `200`: `ListResponse<RecipeRef>`, the (non-deleted) recipes that use this one as a sub-recipe directly. Useful before deleting a recipe or changing its yield. Errors: `404 NOT_FOUND`.

---

## History

The backend keeps two kinds of history. Both are recorded automatically when products and recipes are saved, so the frontend never writes history:

- **Price and cost history**: product prices and recipe food costs over time, as numbers ready for charts. See [product price history](#product-price-history) and [recipe cost history](#recipe-cost-history).
- **Change log**: every change to any field of a product or recipe, including deletions, for a "History" tab or an activity screen. See [product and recipe change log](#product-and-recipe-change-log) and [change feed](#change-feed).

All history endpoints return entries **newest first**.

### Price and cost history

Each entry holds the values after the change and, in `previous`, the values before it.

What creates an entry:

| Event | Product price history | Recipe cost history |
|---|---|---|
| Product created (also inline in a recipe) | `created` | – |
| Product price, package size or package unit changed | `updated` | `product_price_changed` for each recipe whose food cost changed, linked to the product entry |
| Only the product's name, description, manufacturer or inventory changed | – | – |
| Recipe created | – | `created` |
| Recipe saved and its food cost or portions changed | – | `recipe_updated` |
| Recipe saved without changing cost or portions (e.g. renamed, steps edited) | – | – |
| Recipe restored and its food cost changed meanwhile | – | `recipe_restored` |
| A sub-recipe's cost, portions or yield changed, changing this recipe's cost | – | `sub_recipe_changed` (with `subRecipe`) |
| A product price change reached this recipe through a sub-recipe | – | `product_price_changed` (with `cause` and `subRecipe`) |

More details:
- A package change that leaves every recipe cost unchanged (e.g. 200 g → 0.2 kg at the same price) creates a product entry, but no recipe entries.
- A deleted recipe's cost history is kept but hidden (`404`) until the recipe is restored. Nothing is recorded for it while it is deleted.
- Deleting a product keeps the recipe entries it caused. In those entries `cause.productId` becomes `null`, and `cause.productName` keeps the name the product had at the time. While the product exists, `cause.productName` is its current name.
- Products and recipes that existed before history was added start with one `created` entry, dated when they were last changed.
- Timestamps have one-second precision, so two quick changes can share a `changedAt`. Rely on the order of the list rather than sorting by `changedAt`.

### Product price history

`GET /products/:id/price-history`

Response `200`: `ListResponse<ProductPriceChange>`

```json
{
  "items": [
    {
      "id": 7,
      "changedAt": "2026-10-08T14:05:12.000Z",
      "reason": "updated",
      "packageSize": 200,
      "packageUnit": "g",
      "pricePerPackage": 10,
      "pricePerUnit": 50,
      "pricingUnit": "kg",
      "previous": { "packageSize": 200, "packageUnit": "g", "pricePerPackage": 8, "pricePerUnit": 40, "pricingUnit": "kg" },
      "affectedRecipes": [
        { "id": 1, "name": "Shortcrust tart base", "previousFoodCost": 13.75, "foodCost": 16.25 }
      ]
    },
    {
      "id": 1,
      "changedAt": "2026-10-01T09:30:00.000Z",
      "reason": "created",
      "packageSize": 200,
      "packageUnit": "g",
      "pricePerPackage": 8,
      "pricePerUnit": 40,
      "pricingUnit": "kg",
      "previous": null,
      "affectedRecipes": []
    }
  ]
}
```

Errors: `404 NOT_FOUND`.

### Recipe cost history

`GET /recipes/:id/cost-history`

Response `200`: `ListResponse<RecipeCostChange>`

```json
{
  "items": [
    {
      "id": 4,
      "changedAt": "2026-10-08T14:05:12.000Z",
      "reason": "product_price_changed",
      "portions": 10,
      "foodCost": 16.25,
      "costPerPortion": 1.63,
      "previous": { "portions": 10, "foodCost": 13.75, "costPerPortion": 1.38 },
      "cause": {
        "priceChangeId": 7,
        "productId": 1,
        "productName": "Butter 82%",
        "previousPricePerPackage": 8,
        "pricePerPackage": 10,
        "previousPricePerUnit": 40,
        "pricePerUnit": 50,
        "pricingUnit": "kg"
      }
    },
    {
      "id": 1,
      "changedAt": "2026-10-01T09:45:00.000Z",
      "reason": "created",
      "portions": 10,
      "foodCost": 13.75,
      "costPerPortion": 1.38,
      "previous": null,
      "cause": null
    }
  ]
}
```

Errors: `404 NOT_FOUND`.

### Change log

Every create, update and delete of a product or recipe gets an entry listing the changed fields, each with `from` (before) and `to` (after).

| Action | `changes` contains |
|---|---|
| `created` | Every field that has a value, with `from: null`. |
| `updated` | Only the fields that changed. A save that changes nothing is not logged. |
| `deleted` | The last values in `from`, with `to: null`. |
| `restored` | Recipes only. What differs from when the recipe was deleted (e.g. dropped ingredients, new `foodCost`). Always logged, even when empty. |

Tracked fields and their value types:

| Entity | Field | `from` / `to` type |
|---|---|---|
| product | `name`, `description`, `manufacturer` | `string \| null` |
| product | `packageSize`, `inventoryQuantity` | `number` |
| product | `packageUnit` | `Unit` |
| product | `pricePerPackage`, `pricePerUnit` | `number`, rounded to 2 decimals |
| recipe | `name`, `description` | `string \| null` |
| recipe | `portions` | `number` |
| recipe | `sellPrice` | `number \| null`, rounded to 2 decimals |
| recipe | `yieldQuantity` / `yieldUnit` | `number \| null` / `YieldUnit \| null` |
| recipe | `ingredients` | `IngredientSnapshot[]`: the whole list before and after; sub-recipe lines have `recipeId` and `recipeName` |
| recipe | `steps` | `string[]`: the whole list before and after |
| recipe | `foodCost` | `number`, rounded to 2 decimals |

Not tracked: `costPerPortion` (it's `foodCost / portions`), per-line `unitPrice` and `cost`, and `createdAt` / `updatedAt`.

How changes relate:
- **A recipe edit** is one entry with all of its changes, e.g. `ingredients` together with the resulting `foodCost`.
- **A product price change** is one product entry. Each recipe whose food cost changed because of it gets its own entry with only `foodCost`. The recipe entry points to the product entry in `triggeredBy`, and the product entry lists the recipe entries in `triggered`.
- **Sub-recipes pass changes on.** When a sub-recipe's change (an edit, or a product price change it received) changes the cost of recipes that use it, each of those recipes gets a `foodCost` entry whose `triggeredBy` is the sub-recipe's entry. Follow `triggeredBy` to walk down the chain, and `triggered` to walk up.
- **Renaming a product** is logged on the product only. Recipe entries keep `productName` as it was when the recipe changed.
- **Deleted products and recipes** keep their log: their change log endpoints still work, and the entries appear in the [change feed](#change-feed).
- **Failed saves** log nothing.
- **Earlier changes:** the log starts when this feature was added, so earlier changes have no entries. History from that point on is complete.

### Product and recipe change log

`GET /products/:id/changes`
`GET /recipes/:id/changes`

Response `200`: `ListResponse<ChangeLogEntry>`, newest first. Errors: `404 NOT_FOUND`, only if the id never existed.

Product example. A price change that changed one recipe's food cost, after the product was created:

```json
{
  "items": [
    {
      "id": 15,
      "changedAt": "2026-10-09T08:12:40.000Z",
      "entityType": "product",
      "entityId": 1,
      "entityName": "Butter 82%",
      "action": "updated",
      "changes": [
        { "field": "pricePerPackage", "from": 8, "to": 10 },
        { "field": "pricePerUnit", "from": 40, "to": 50 }
      ],
      "triggeredBy": null,
      "triggered": [
        {
          "id": 16,
          "changedAt": "2026-10-09T08:12:40.000Z",
          "entityType": "recipe",
          "entityId": 1,
          "entityName": "Shortcrust tart base",
          "action": "updated",
          "changes": [{ "field": "foodCost", "from": 10.9, "to": 13.4 }]
        }
      ]
    },
    {
      "id": 1,
      "changedAt": "2026-10-08T09:00:00.000Z",
      "entityType": "product",
      "entityId": 1,
      "entityName": "Butter 82%",
      "action": "created",
      "changes": [
        { "field": "name", "from": null, "to": "Butter 82%" },
        { "field": "manufacturer", "from": null, "to": "Dairy Co." },
        { "field": "packageSize", "from": null, "to": 200 },
        { "field": "packageUnit", "from": null, "to": "g" },
        { "field": "pricePerPackage", "from": null, "to": 8 },
        { "field": "pricePerUnit", "from": null, "to": 40 },
        { "field": "inventoryQuantity", "from": null, "to": 1000 }
      ],
      "triggeredBy": null,
      "triggered": []
    }
  ]
}
```

Recipe example. The food cost change caused by that price change, and an earlier edit of the ingredients:

```json
{
  "items": [
    {
      "id": 16,
      "changedAt": "2026-10-09T08:12:40.000Z",
      "entityType": "recipe",
      "entityId": 1,
      "entityName": "Shortcrust tart base",
      "action": "updated",
      "changes": [{ "field": "foodCost", "from": 10.9, "to": 13.4 }],
      "triggeredBy": {
        "id": 15,
        "changedAt": "2026-10-09T08:12:40.000Z",
        "entityType": "product",
        "entityId": 1,
        "entityName": "Butter 82%",
        "action": "updated",
        "changes": [
          { "field": "pricePerPackage", "from": 8, "to": 10 },
          { "field": "pricePerUnit", "from": 40, "to": 50 }
        ]
      },
      "triggered": []
    },
    {
      "id": 12,
      "changedAt": "2026-10-08T16:30:02.000Z",
      "entityType": "recipe",
      "entityId": 1,
      "entityName": "Shortcrust tart base",
      "action": "updated",
      "changes": [
        {
          "field": "ingredients",
          "from": [
            { "productId": 1, "productName": "Butter 82%", "quantity": 200, "unit": "g" },
            { "productId": 2, "productName": "Wheat flour type 450", "quantity": 300, "unit": "g" }
          ],
          "to": [
            { "productId": 1, "productName": "Butter 82%", "quantity": 250, "unit": "g" },
            { "productId": 2, "productName": "Wheat flour type 450", "quantity": 300, "unit": "g" }
          ]
        },
        { "field": "foodCost", "from": 8.9, "to": 10.9 }
      ],
      "triggeredBy": null,
      "triggered": []
    }
  ]
}
```

### Change feed

`GET /changes?entityType=recipe&limit=50&before=120`

Recent changes across all products and recipes, newest first. Use it for an activity screen, or to find the history of something that has been deleted.

| Query | Type | Notes |
|---|---|---|
| `entityType` | `product` \| `recipe`, optional | Only changes of this kind of entity. |
| `limit` | integer 1–200, default 50 | Page size. |
| `before` | integer, optional | Only entries older than this entry id. Pass the previous response's `nextBefore`. |

Response `200`: `ChangeFeed`, i.e. `{ "items": ChangeLogEntry[], "nextBefore": number | null }`. When `nextBefore` is `null`, there are no more pages. Errors: `400 VALIDATION_ERROR` for invalid query values.

---

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": { "issues": [{ "path": "body.name", "message": "Too small: expected string to have >=1 characters" }] }
  }
}
```

| Status | `code` | `details` | When |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `{ issues: ValidationIssue[] }` | Invalid body, path or query. Field problems are reported together; checks against stored products (unknown product, wrong unit) run once the fields themselves are valid. |
| 400 | `BAD_REQUEST` | none | Malformed JSON (status 413 if the body is over 1 MB). |
| 401 | `UNAUTHORIZED` | none | No `Authorization: Bearer` header, or the token is invalid or expired. Refresh the session or send the user to the login page. |
| 404 | `NOT_FOUND` | none | Unknown id (`"Product 99 not found"`), another user's id, or route. |
| 409 | `PRODUCT_IN_USE` | `{ recipes: RecipeRef[] }` | Deleting a product that recipes use. |
| 409 | `UNIT_CONFLICT` | `{ recipes: RecipeRef[] }` | Changing a product's unit kind, or removing or changing the kind of a recipe's yield, while recipes use it that way. |
| 409 | `RECIPE_NOT_DELETED` | none | Restoring a recipe that isn't deleted. |
| 409 | `RECIPE_IN_USE` | `{ recipes: RecipeRef[] }` | Deleting a recipe that other recipes use as a sub-recipe. |
| 500 | `INTERNAL_ERROR` | none | Unexpected server error. |

**Mapping issues to form fields.** `path` starts with where the problem is: `body.`, `params.` or `query.`. Strip `body.` to get the form field:

```ts
export function fieldErrors(err: ApiError): Record<string, string> {
  const result: Record<string, string> = {};
  const issues = err.error.details && 'issues' in err.error.details ? err.error.details.issues : [];
  for (const issue of issues) {
    result[issue.path.replace(/^body\./, '')] = issue.message; // e.g. 'ingredients[1].unit'
  }
  return result;
}
```

Messages written for this app ("must be one of: mg, g, kg", "Provide pricePerPackage or pricePerUnit", "Product 99 does not exist") are fine to show to users. Generic type and length messages (`Too small: expected number to be >0`) are technical. Validate in the form with friendly messages, and use the server's message only as a fallback.

---

## UI flows and gotchas

**Product form: prices.** Show both price inputs. Send only the price the user edited, and the API fills in the other. If you send both, `pricePerPackage` wins, so the user's edit to the per-unit price would be lost. Label the unit price with `pricingUnit`, e.g. "40.00 / kg".

**Product form: inventory.** `inventoryQuantity` is in `packageUnit`, so show the unit next to the input: "1000 g".

**Ingredient unit picker.** After a product is chosen, offer only `compatibleUnits(product.packageUnit)` (see [Units](#units)). For a sub-recipe, offer `subRecipeUnits(recipe)`: `portion`, plus weight or volume units if it has a yield. That avoids the unit validation error altogether.

**Ingredient picker with recipes.** Let the user pick from products and from recipes (`GET /recipes`). Leave out the recipe being edited and, ideally, recipes that already use it. Otherwise the API rejects the loop with a `400` you can show. Render lines by `type`, using `name` for the label. If a recipe has no yield, you can suggest adding one so it can be used in grams.

**After saving a recipe that others use,** their costs have changed too. Invalidate cached recipes and recipe lists, not just the edited recipe.

**"Add new product" inside the recipe editor.** Collect the product fields in a small dialog and put them in the ingredient as `product: { ... }` instead of `productId`. The product is created only when the recipe is saved successfully. If you would rather create it immediately, call `POST /products` first and use the returned `id` as `productId`.

**After saving a product,** if `recalculatedRecipes` is not empty, tell the user, e.g. "Price updated. 2 recipes recalculated: Chantilly cream 18.23 → 19.23, …". Then invalidate any cached recipes and recipe lists.

**Deleting a product.** On `409 PRODUCT_IN_USE`, show `details.recipes` with links to those recipes. You can also call `GET /products/:id/recipes` before showing the delete button.

**Ingredient ids aren't stable.** Saving a recipe replaces its ingredient lines, so their `id` values change. Use the array index, or your own client-side key, as the list key in the editor.

**Saving the recipe editor.** Simplest is `PUT /recipes/:id` with the full form, or `PATCH` with only the changed fields. Remember that `ingredients` and `steps` are always replaced as whole lists.

**Food cost is calculated on the server.** Use the `ingredientCost` helper for a live preview while editing, then show the server's numbers after saving.

**Product price history screen.** Each entry reads naturally as "8.00 → 10.00 per 200 g (40.00 → 50.00 / kg)", with `affectedRecipes` underneath: "Shortcrust tart base 13.75 → 16.25". For a chart, reverse the list and plot `pricePerUnit` over `changedAt`. Unlike the package price, it stays comparable when the package size changes.

**Recipe cost history screen.** Explain each entry from `reason`: "Created", "Recipe edited", or for `product_price_changed`, "Butter 82%: 8.00 → 10.00 per package", using `cause`. Link to the product when `cause.productId` is not null. For a chart, reverse the list and plot `costPerPortion` or `foodCost`.

**Keep history in sync.** A product price change adds entries to the product's history and to every affected recipe's history. Invalidate those cached histories together with the recipes.

**History tab (change log).** Show one row per entry: date, action and the changed fields, e.g. "9 Oct 08:12 · Edited · Name: Tort → Tort czekoladowy". Map `field` to a label in your UI language. Format money fields with 2 decimals and add the unit to `packageSize` and `inventoryQuantity`. For a recipe entry with `triggeredBy`, explain the cause: "Food cost 10.90 → 13.40, because the price of Butter 82% changed 8.00 → 10.00". For a product entry with `triggered`, list the affected recipes.

**Ingredient list changes.** `ingredients` holds the whole list before and after. To show what actually changed, compare the two lists:

```ts
// Added, removed and changed lines, matched by product. If a product appears twice in the
// same recipe, only one of its lines is compared. A change of order alone shows nothing here.
export function diffIngredients(from: IngredientSnapshot[] | null, to: IngredientSnapshot[] | null) {
  const before = new Map((from ?? []).map((line) => [line.productId, line]));
  const after = new Map((to ?? []).map((line) => [line.productId, line]));
  return {
    added: [...after.values()].filter((line) => !before.has(line.productId)),
    removed: [...before.values()].filter((line) => !after.has(line.productId)),
    changed: [...after.values()]
      .filter((line) => {
        const old = before.get(line.productId);
        return old !== undefined && (old.quantity !== line.quantity || old.unit !== line.unit);
      })
      .map((line) => ({ from: before.get(line.productId)!, to: line })),
  };
}
```

**Deleted items.** A change log entry may point to a product or recipe that has since been deleted. Fetching it returns `404`, so show it as "deleted" instead of a link. Its change log still works.

**Undo after deleting a recipe.** Keep the id and show an "Undo" action that calls `POST /recipes/:id/restore`. After a restore, refresh recipe lists and product usage. If `droppedIngredients` is not empty, tell the user which ingredients could not be brought back and why.

**Finding deleted recipes.** There is no list of deleted recipes. Use the [change feed](#change-feed) with `entityType=recipe` and look for `deleted` entries without a later `restored` entry for the same `entityId`. Ask for a dedicated endpoint if you need a proper bin.

## Not supported yet

- Creating a sub-recipe inline while saving another recipe.
- Converting between weight and volume (g ↔ ml).
- Pagination and sort options (lists are sorted by name).
- Photos.
- Reducing inventory automatically when a recipe is made.
