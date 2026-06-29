---
name: nextjs16
description: "Next.js 16 API reference for breaking changes. Trigger this whenever writing or reviewing any Next.js code in this project — route handlers, server components, middleware, layout/page files, config, or anything that touches headers/cookies/params. The training data for Next.js is stale; always consult this skill before writing Next.js code."
---

# Next.js 16 — Breaking Changes Reference

This project runs **Next.js 16.2.7**. The API surface differs significantly from training data (Next.js 13/14). Check every item below before writing code.

---

## Async Request APIs (BREAKING)

These are now **async** — you must `await` them:

```ts
// cookies, headers, draftMode
const cookieStore = await cookies()
const headersList = await headers()

// params and searchParams in page/layout/route files
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}

export default async function Page({ searchParams }: { searchParams: Promise<{ q: string }> }) {
  const { q } = await searchParams
}
```

Applies to: `layout.js`, `page.js`, `route.js`, `default.js`, `generateMetadata`, `generateViewport`.

---

## Caching — No Longer Cached by Default

`GET` Route Handlers are **not cached** by default. Opt in explicitly:

```ts
export const dynamic = 'force-static'
```

Client Router Cache `staleTime` is now `0` — pages always refetch on navigation.

---

## Middleware / Proxy File

In Next.js 16, `middleware.ts` is renamed to **`proxy.ts`**. The named export must be `proxy` (or use a default export) — not `middleware`.

```ts
// proxy.ts — correct
export const proxy = auth          // named export
export default auth                // or default export — both work
export const config = { matcher: [...] }
```

**Runtime:** `proxy.ts` runs **Node.js only** — edge runtime is not supported and cannot be configured. This means you can import Node.js modules (Prisma, `fs`, etc.) directly in `proxy.ts`. No edge-safe config split required.

**Auth.js v5 with database sessions in proxy:** Since Node.js is available, import `auth` from the full `@/auth` (with PrismaAdapter). The "config split" pattern (`auth.config.ts` for edge, `auth.ts` for Node) is only needed if you're still on middleware/edge — not required for proxy.

```ts
// proxy.ts — with Auth.js v5
import { auth } from "@/auth"
export const proxy = auth
export const config = { matcher: ["/canvas", "/api/runs/:path*"] }
```

`middleware.ts` still works with a deprecation warning but is ignored for runtime purposes in some build contexts — do not rely on it.

**Turbopack is now the default bundler** for `next dev` and `next build`. If `next.config.ts` has a `webpack:` key with custom loaders or plugins, verify they work under Turbopack or add a `--webpack` flag. Silent breakage is common here.

---

## Config

TypeScript config is now supported:

```ts
// next.config.ts
import type { NextConfig } from 'next'
const nextConfig: NextConfig = {}
export default nextConfig
```

Config option renames (stable names):
- `serverComponentsExternalPackages` → `serverExternalPackages`
- `bundlePagesExternals` → `bundlePagesRouterDependencies`

---

## Server Actions

- Unused Server Actions are dead-code-eliminated from the client bundle
- Action IDs are non-deterministic and periodically rotated — do not hardcode them
- `revalidateTag` and `revalidatePath` **throw** if called during render

---

## `next/dynamic`

- `suspense` prop removed
- `ssr: false` not allowed in Server Components

---

## Reading Docs Locally

The CLAUDE.md instruction says to read `node_modules/next/dist/docs/` — use that path for any API not covered here.
