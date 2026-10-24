# fc-backend

REST API for the pastry chef app (mobile and web). Step 1 covers products, recipes and automatic food cost.

Stack: Node.js 24, Express 5, Knex, Zod. SQLite locally, PostgreSQL (Supabase) in production.

## Getting started

```bash
npm install
cp .env.example .env   # then set SUPABASE_URL (required, see Login below)
npm run migrate        # create tables in data/dev.sqlite3
npm run dev            # http://localhost:3000, restarts on file changes
SEED_USER_ID=<your user id> npm run seed   # optional: demo data for one user (replaces that user's data)
```

## Login

Users log in with Google through Supabase Auth in the web app. Every `/api/v1` request carries the Supabase access token (`Authorization: Bearer ...`), and the API checks it against the public keys of the project in `SUPABASE_URL`. Each user's products, recipes and history are theirs alone; `/health` is public. Your user id (for `SEED_USER_ID`) is under Authentication → Users in the Supabase dashboard.

| Script | What it does |
|---|---|
| `npm run dev` | Start with auto-restart |
| `npm start` | Start |
| `npm test` | Run all tests (in-memory SQLite, nothing to set up) |
| `npm run migrate` / `migrate:rollback` | Apply / undo database migrations |
| `npm run seed` | Load demo data for `SEED_USER_ID` |

Configuration is read from environment variables or a `.env` file. See [.env.example](.env.example).

## Project layout

```
src/
  app.js, server.js, config.js
  db/            knex setup, migrations, seeds
  lib/           units, errors, rounding, shared schemas
  middleware/    request validation, error responses
  modules/
    products/    schema (zod) · mapper · service (logic + queries) · routes
    recipes/     schema · service · routes · costing (price math + recalculation)
    history/     recorder (writes entries during saves) · snapshots (what the change log compares) · service (reads) · routes (change feed)
test/            unit tests and API tests
```

## Pricing rules

- **Units**: `mg`, `g`, `kg` (weight), `ml`, `l` (volume) and `piece`. A recipe can only use a product in a unit of the same kind: butter bought in `g` can be used in `mg`, `g` or `kg`, but not in `ml`.
- **Product price**: send `pricePerPackage` or `pricePerUnit`, and the other is calculated. `pricePerUnit` is per **kg**, **l** or **piece**, depending on the package unit (returned as `pricingUnit`). If both are sent, `pricePerPackage` wins. Changing only `packageSize` keeps the package price and recalculates the unit price.
- **Inventory**: `inventoryQuantity` is expressed in the product's `packageUnit`.
- **Ingredient cost**: `unitPrice` is the price of one unit of the ingredient (e.g. 1 g), and `cost = quantity × unitPrice`.
- **Recipe**: `foodCost` = sum of ingredient costs. `costPerPortion = foodCost / portions`. `sellPrice` is optional and is the selling price of the whole recipe.
- **Price changes**: when a product's price, package size or package unit changes, every recipe using it is recalculated in the same transaction. The update response lists them in `recalculatedRecipes`.
- **History**: every product price change and every change in a recipe's food cost or portions is recorded with the values before and after. A recipe entry caused by a product price change links to that change.
- **Change log**: every create, update and delete of a product or recipe is logged field by field (`from` → `to`), including ingredient lists and steps. A recipe food cost change caused by a product price change links to the product change. Entries outlive deleted products and recipes.
- **Sub-recipes**: a recipe line can be another recipe (`recipeId`), used in portions or, if the sub-recipe has a yield (e.g. 550 g), by weight or volume. Cost changes flow up through every level. Loops are rejected, and recipes in use can't be deleted.
- **Deleting recipes**: recipes are soft-deleted. A deleted recipe is hidden everywhere and doesn't count as using its products, but it keeps its data and can be restored. Products are deleted for real.
- **Rounding**: values are stored at full precision. Responses round money to 2 decimals and `unitPrice` to 6.

## API

The full endpoint reference for frontend work, with TypeScript types, examples, errors and UI notes, is in **[docs/API.md](docs/API.md)**.

Quick overview (base path `/api/v1`, except `/health`):

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/products?search=` | List products (search by name or manufacturer) |
| GET | `/products/:id` | One product |
| GET | `/products/:id/recipes` | Recipes that use the product |
| GET | `/products/:id/price-history` | Price changes, newest first, with the recipes each one affected |
| GET | `/products/:id/changes` | Change log of the product (all fields), newest first |
| POST | `/products` | Create (201) |
| PUT | `/products/:id` | Replace. Returns `{ product, recalculatedRecipes }` |
| PATCH | `/products/:id` | Partial update. Returns `{ product, recalculatedRecipes }` |
| DELETE | `/products/:id` | Delete (204). **409 `PRODUCT_IN_USE`** if a recipe uses it |
| GET | `/recipes?search=` | List recipe summaries |
| GET | `/recipes/:id` | Full recipe with ingredients and steps |
| GET | `/recipes/:id/cost-history` | Food cost changes, newest first, with the product price change that caused each one |
| GET | `/recipes/:id/changes` | Change log of the recipe (all fields), newest first |
| GET | `/recipes/:id/used-in` | Recipes that use this recipe as a sub-recipe |
| GET | `/changes?entityType=&limit=&before=` | Change feed across all products and recipes, paged |
| POST | `/recipes` | Create (201) |
| PUT | `/recipes/:id` | Replace (missing lists become empty) |
| PATCH | `/recipes/:id` | Partial update. A list that is sent replaces the stored list |
| DELETE | `/recipes/:id` | Soft delete (204). The recipe is hidden but keeps its data |
| POST | `/recipes/:id/restore` | Restore a deleted recipe, recalculated with current prices. Returns `{ recipe, droppedIngredients }` |

## Deployment

Production: the API on Render, the database and login on Supabase, the web app on Vercel. A push to `master` runs the tests in GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)), and Render deploys only when they pass.

1. **Supabase.** Create a project (EU region). In **Connect**, copy the **Session pooler** connection string (the direct connection is IPv6-only, which Render can't reach). Set up Google login: Authentication → Providers → Google, with an OAuth client from Google Cloud Console whose redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Render.** New → Blueprint → this repo. [render.yaml](render.yaml) defines the service; fill in `DATABASE_URL`, `SUPABASE_URL` and `CORS_ORIGIN` when asked. Migrations run on every start (`npm run migrate && npm start`).
3. Check `https://<service>.onrender.com/health`.

The migration that added user accounts turns on row level security (with no policies) for every table, so Supabase's public REST API can't read the data with the anon key. Tables added later need `alter table <name> enable row level security` in their migration too.

The free Render plan sleeps after 15 minutes without requests, so the first request after that takes about 30 seconds. Free Supabase projects pause after a week of inactivity.
