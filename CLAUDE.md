# fc-backend

Node 22 + Express 5 REST API. Knex ORM with SQLite in development and PostgreSQL in production. Supabase Auth for JWT verification only — Supabase is not the database.

## Commands

```bash
npm run dev              # start with --watch, port 4000
npm run migrate          # run pending Knex migrations
npm run migrate:rollback # roll back the last migration batch
npm run seed             # run Knex seed files
npm run catalog:import   # one-off: import product catalog (scripts/import-catalog.js)
npm test                 # Node built-in test runner + supertest integration tests
```

## Config

Copy `.env.example` to `.env`:

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_URL` | yes | Supabase project URL — used to fetch JWKS and verify tokens |
| `DATABASE_URL` | no | PostgreSQL DSN; leave empty to use SQLite at `data/dev.sqlite3` |
| `PORT` | no | Defaults to `3000`; `npm run dev` overrides to `4000` |
| `CORS_ORIGIN` | no | Comma-separated allowed origins, or `*` |
| `CATALOG_PUBLIC` | no | Set `true` to allow unauthenticated reads of `/api/v1/catalog` |
| `DATABASE_SSL` | no | Set `false` for a local PostgreSQL without SSL |
| `LEGACY_OWNER_ID` | no | Only needed when migrating pre-ownership data |

## Structure

```
src/
  modules/
    products/     # products CRUD, inventory, pricing
    recipes/      # recipes CRUD, food-cost calculation, sub-recipes
    catalog/      # read-only ingredient catalog
    history/      # price history, cost history, change log
  middleware/
    auth.js       # Supabase JWT verification via JWKS (cached)
    validate.js   # Zod schema validation helper
    errorHandler.js
  db/
    migrations/   # Knex migration files (timestamped)
    seeds/        # Knex seed files
  lib/
    units.js      # unit conversion logic
    schemas.js    # shared Zod schemas
    errors.js     # typed error classes
```

Each module follows the same pattern: `*.routes.js` → `*.service.js`, with `*.schema.js` (Zod) for request validation and `*.mapper.js` for response shaping.

## Auth

Every request to `/api/v1/*` must carry `Authorization: Bearer <token>`. The `requireAuth` middleware verifies the Supabase JWT against the project's public JWKS (fetched once and cached). All service queries are scoped to `req.user.id` so each user sees only their own data.

The `/health` endpoint is unauthenticated. `/api/v1/catalog` is unauthenticated when `CATALOG_PUBLIC=true`.

## API types

The canonical TypeScript type definitions live in **`docs/API.md`**. When you change a request or response shape:
1. Update `docs/API.md` first.
2. Copy the updated types to both clients: `fc-frontend/src/api/types.ts` and `fc-mobile/src/api/types.ts`.
