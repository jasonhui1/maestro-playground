---
name: prisma7
description: "Prisma 7 API reference. Trigger whenever writing Prisma schema, PrismaClient instantiation, queries, migrations, seeding, or any code that imports from the generated client. This project uses Prisma 7.8.0 which has multiple documented failures (see ERRORS.md) — training data is wrong about the constructor, adapter, client path, and migration behavior."
---

# Prisma 7 — Breaking Changes Reference

This project uses **Prisma 7.8.0** with `@prisma/adapter-better-sqlite3`. Cross-reference with ERRORS.md which documents specific failures already hit in this project.

---

## PrismaClient Constructor — Adapter Required

Zero-arg `new PrismaClient()` is gone. An adapter is always required:

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "@/generated/prisma/client"

const adapter = new PrismaBetterSqlite3({ url: "file:./prisma/dev.db" })
export const prisma = new PrismaClient({ adapter })
```

**Common mistakes already documented in ERRORS.md:**
- `PrismaLibSQL` does not exist — use `PrismaBetterSqlite3`
- Do not pass a raw `better-sqlite3` `Database` instance — pass `{ url: "file:..." }`
- URL is resolved relative to **CWD at runtime**, not relative to the schema file

---

## Generated Client Import Path

```ts
// WRONG — no index.ts in Prisma 7
import { PrismaClient } from "@/generated/prisma"

// CORRECT
import { PrismaClient } from "@/generated/prisma/client"
```

---

## Schema Generator Block

`output` is now **required** in the generator block:

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../generated/prisma"
}
```

Note: provider changed from `prisma-client-js` to `prisma-client`.

---

## Migrations — Manual Table Application

`prisma migrate dev` does NOT automatically create tables when using the better-sqlite3 adapter on Windows (path resolution bug). After running migrate, verify tables exist:

```ts
const db = require('better-sqlite3')('./prisma/dev.db')
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
```

If empty, apply the migration SQL manually:

```ts
const sql = fs.readFileSync('./prisma/migrations/<name>/migration.sql', 'utf8')
sql.split(';').filter(s => s.trim()).forEach(s => db.exec(s + ';'))
```

---

## ESM-Only

Prisma 7 is ESM-only. `require()` no longer works for importing PrismaClient or generated types. This affects:

- Seeding scripts written as CommonJS (`.js` with `require()`) — convert to ESM or use `.mjs`
- Any `ts-node` usage without `"module": "ESNext"` in tsconfig — add `--esm` flag or switch to `tsx`
- `next.config.js` that did `require('@prisma/client')` — switch to `import` syntax in `next.config.ts`

The project's manual migration workaround in ERRORS.md uses `require('better-sqlite3')` — this still runs fine in Node.js scripts because it's a native addon, not a Prisma import. Don't conflate the two.

---

## `prisma.config.ts`

Prisma 7 introduces a top-level `prisma.config.ts` for configuration that previously lived inline in `schema.prisma` (datasource URLs, migration paths, etc.):

```ts
// prisma.config.ts
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: './prisma/schema.prisma',
})
```

This is optional for now but will become the primary config surface. If you see references to `prisma.config.ts` in docs or error messages, this is what they mean.

---

## Auto-Generate Removed

These no longer auto-generate the client:
- `prisma migrate dev`
- `prisma db push`

Run `prisma generate` explicitly after schema changes.

---

## Removed CLI Flags

- `--skip-generate` — gone
- `--skip-seed` — gone

---

## Removed Features

- **Client middleware API** — use Client Extensions instead
- **Metrics preview** — use driver adapter alternatives
- **Automatic seeding** — must call `prisma db seed` explicitly

---

## Seeding

Seeding is no longer automatic. Run:

```bash
npx prisma db seed
# or the project script:
npm run db:seed
```
