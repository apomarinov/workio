# Backend Domain Architecture

## Overview

The backend is being restructured from god files (`db.ts`, `routes/*.ts`) into a domain-oriented architecture. Each domain is a self-contained folder that owns its DB queries, Zod schemas, and tRPC procedures.

## Directory Structure

```
server/domains/
  {domain}/
    schema.ts      — Zod schemas (source of truth for types + input validation)
    db.ts          — Raw SQL queries (reads + writes)
    queries.ts     — tRPC query procedures
    mutations.ts   — tRPC mutation procedures
    router.ts      — Merges queries + mutations, exports domain router
```

### Root Router

```
server/trpc/router.ts — Imports all domain routers, merges into appRouter
```

```ts
export const appRouter = router({
  settings: settingsRouter,
  notifications: notificationsRouter,
  sessions: sessionsRouter,
  terminals: terminalsRouter,
  workspace: workspaceRouter,
  github: githubRouter,
  logs: logsRouter,
})
```

## Domains

| Domain | DB Tables | Summary |
|---|---|---|
| **settings** | settings | User prefs, push subscriptions, VAPID keys |
| **notifications** | notifications | CRUD, mark read/unread, push delivery |
| **sessions** | sessions, messages, prompts, hooks | Session CRUD, messages, search, backfill, move, permissions |
| **terminals** | terminals, shells, projects | Terminal + shell CRUD, git operations (branches, commits, diff) |
| **workspace** | — | Git dirty status, processes, port forwarding, setup/teardown |
| **github** | — | PR management, webhooks, reactions, checks |
| **logs** | command_logs | Command log querying (read-only) |

## Conventions

### Zod Schemas (`schema.ts`)

Schemas are the **source of truth** for domain types. No manual `type` declarations — use `z.infer<>` instead.

```ts
// server/domains/settings/schema.ts
import { z } from 'zod'

export const settingsSchema = z.object({
  id: z.number(),
  default_shell: z.string().nullable(),
  font_size: z.number().min(8).max(32).nullable(),
  // ...
})

export type Settings = z.infer<typeof settingsSchema>

export const updateSettingsInput = settingsSchema.partial().omit({ id: true })
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>
```

Schemas serve dual purpose:
- **Types** via `z.infer<>` (replaces manual type declarations)
- **Runtime validation** via tRPC `.input(schema)` on mutations/queries

### DB Functions (`db.ts`)

Raw SQL using `pg`. Each domain owns its queries — no shared god file.

```ts
// server/domains/settings/db.ts
import { pool } from '../../db/pool'
import type { Settings } from './schema'

export async function getSettings(): Promise<Settings> {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1')
  return rows[0]
}
```

The shared `pool` instance (and helpers like `buildSetClauses`, `withTransaction`) stay in `server/db/pool.ts` as shared infrastructure.

### tRPC Queries (`queries.ts`)

Read-only procedures. No `.input()` needed for simple fetches.

```ts
// server/domains/settings/queries.ts
import { publicProcedure } from '../../trpc/init'
import { getSettings } from './db'

export const settingsQueries = {
  get: publicProcedure.query(() => getSettings()),
}
```

### tRPC Mutations (`mutations.ts`)

Write procedures. Use Zod schemas for `.input()` validation — this replaces the manual validation currently done in route handlers.

```ts
// server/domains/settings/mutations.ts
import { publicProcedure } from '../../trpc/init'
import { updateSettings } from './db'
import { updateSettingsInput } from './schema'

export const settingsMutations = {
  update: publicProcedure
    .input(updateSettingsInput)
    .mutation(({ input }) => updateSettings(input)),
}
```

### Domain Router (`router.ts`)

Merges queries and mutations into a single router.

```ts
// server/domains/settings/router.ts
import { router } from '../../trpc/init'
import { settingsQueries } from './queries'
import { settingsMutations } from './mutations'

export const settingsRouter = router({
  ...settingsQueries,
  ...settingsMutations,
})
```

## What Does NOT Move

These stay where they are — they're infrastructure, not API/DB concerns:

- **`pty/`** — PTY session management, worker processes
- **`ssh/`** — Connection pooling, tunneling, config parsing
- **`ws/`** — WebSocket terminal handler
- **`io.ts`** — Socket.IO setup, broadcast helpers
- **`listen.ts`** — PostgreSQL LISTEN/NOTIFY
- **`push.ts`** — Web push delivery
- **`notify.ts`** — Notification emission (Socket.IO + push)
- **`services/`** — Service status tracking
- **`github/checks.ts`** — PR polling loop (the polling/caching stays; route-facing functions move to the github domain)
- **`github/webhooks.ts`** — Ngrok management, webhook validation polling
- **`index.ts`** — Server startup, hook registration, Socket.IO events

Domains can import from these infrastructure modules as needed.

## Migration Strategy

1. **Incremental** — migrate one domain at a time, smallest first
2. **Coexist** — REST routes (`routes/*.ts`) and tRPC routes run side by side during migration
3. **Client update** — switch client from SWR+fetch to `trpc.{domain}.{procedure}.useQuery()` / `.useMutation()`
4. **Cleanup** — delete the REST route file once fully migrated, remove functions from old `db.ts`

### Order

1. settings (smallest — 3 DB functions, 6 endpoints)
2. logs (read-only — 2 endpoints)
3. notifications (10 endpoints, self-contained)
4. sessions (14 endpoints, complex but isolated)
5. terminals (largest — needs splitting terminals vs shells vs git)
6. workspace (git status, processes, port forwarding)
7. github (22 endpoints, depends on checks.ts service layer)

## Shared Infrastructure

After all domains are extracted, `server/db.ts` becomes `server/db/pool.ts`:

```
server/db/
  pool.ts          — pg Pool instance, buildSetClauses, withTransaction
```
