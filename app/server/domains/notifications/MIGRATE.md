# Notifications Domain — Phase 2: Consumer Migration

All new domain files are in place (`server/domains/notifications/`). This plan covers switching every consumer to use them and deleting the old files.

## Server-Side Migrations

### 1. `server/index.ts`

**Current imports:**
- Line 28: `import { emitNotification } from './notify'`
- Line 42: `import { initWebPush, markDesktopActive } from './push'`
- Line 46: `import notificationRoutes from './routes/notifications'`
- Line 48: `import settingsRoutes from './routes/settings'`

**Changes:**
- Replace notify + push imports with `import { emitNotification, initWebPush, markDesktopActive } from '@domains/notifications/service'`
- Remove `import notificationRoutes from './routes/notifications'`
- Remove `import settingsRoutes from './routes/settings'`
- Remove line 397: `await fastify.register(settingsRoutes)`
- Remove line 400: `await fastify.register(notificationRoutes)`
- Usage stays identical: `emitNotification('auth_lockout', ...)` at line 206, `initWebPush()` at line 230, `markDesktopActive()` at line 337

### 2. `server/workspace/emit.ts`

**Current:** Line 2: `import { emitNotification } from '../notify'`
**Change:** `import { emitNotification } from '@domains/notifications/service'`

### 3. `server/github/checks.ts`

**Current:** Line 29: `import { emitNotification } from '../notify'`
**Change:** `import { emitNotification } from '@domains/notifications/service'`

### 4. `server/listen.ts`

**Current:**
- Line 3: `import { resolveNotification } from '../shared/notifications'`
- Line 14: `import { sendPushNotification } from './push'`

**Change:**
- `import { resolveNotification } from '@domains/notifications/registry'`
- `import { sendPushNotification } from '@domains/notifications/service'`

### 5. `server/pty/manager.ts`

**Current:**
- Line 6: `import { resolveNotification } from '../../shared/notifications'`
- Line 28: `import { sendPushNotification } from '../push'`

**Change:**
- `import { resolveNotification } from '@domains/notifications/registry'`
- `import { sendPushNotification } from '@domains/notifications/service'`

### 6. `server/ws/terminal.ts`

**Current:** Line 18: `import { sendPushNotification } from '../push'`
**Change:** `import { sendPushNotification } from '@domains/notifications/service'`

### 7. `server/db.ts`

**Remove:**
- Line 6: `import type { UnreadPRNotification } from '../shared/types'`
- Line 893: `export { getOrCreateVapidKeys } from '@domains/notifications/service'` — only consumer is `server/push.ts` (being deleted) and `server/routes/settings.ts` (being deleted). Already moved to notifications domain.
- Lines 897-907: `Notification` interface
- Lines 909-1070: All 10 notification DB functions

`getSettings` and `updateSettings` re-exports on line 894 stay — they have many non-notification consumers.

## Client-Side Migrations

### 8. `src/context/NotificationContext.tsx` — Import swap only

**Current:** Line 9: `import type { AudioType } from '../../shared/notifications'`
**Change:** `import type { AudioType } from '@domains/notifications/registry'`

No logic changes. This context handles browser permission and audio, not data fetching.

### 9. `src/context/ProcessContext.tsx` — Import swap only

**Current:** Line 2: `import { resolveNotification } from '../../shared/notifications'`
**Change:** `import { resolveNotification } from '@domains/notifications/registry'`

Usage at line 289: `resolveNotification('bell_notify', data)` — unchanged.

### 10. `src/hooks/useNotificationSubscriptions.ts` — Import swap only

**Current:** Line 2: `import { resolveNotification } from '../../shared/notifications'`
**Change:** `import { resolveNotification } from '@domains/notifications/registry'`

### 11. `src/components/NotificationList.tsx` — Import swaps only

**Current:**
- Line 22: `import type { Notification } from '@/types'`
- Lines 24-26: `import { NOTIFICATION_REGISTRY, resolveTemplate } from '../../shared/notifications'`

**Change:**
- `import type { Notification } from '@domains/notifications/schema'`
- `import { NOTIFICATION_REGISTRY, resolveTemplate } from '@domains/notifications/registry'`

### 12. `src/context/NotificationDataContext.tsx` — SWR → tRPC rewrite

This is the biggest change. Currently uses SWR + `api.*` fetch wrappers. Rewrite to tRPC + react-query.

**Current data fetching (SWR):**
```ts
const { data: notifications = [], mutate: mutateNotifications } = useSWR<Notification[]>(
  '/api/notifications', () => api.getNotifications().then(r => r.notifications)
)
const { data: unreadPRData = EMPTY_UNREAD, mutate: mutateUnreadPRData } =
  useSWR(UNREAD_PR_KEY, fetchUnreadPRData)
```

**New data fetching (tRPC):**
```ts
const utils = trpc.useUtils()
const { data: listData } = trpc.notifications.list.useQuery({ limit: 50, offset: 0 })
const notifications = listData?.notifications ?? []
// prUnread stays SWR — see section 13 below
```

**Optimistic update pattern change:**

SWR uses `mutate(updaterFn, { revalidate: false })`. tRPC/react-query uses `utils.notifications.list.setData()`.

Each mutation callback changes like this (using `markNotificationRead` as example):

```ts
// Before (SWR)
await api.markNotificationRead(id)
mutateNotifications(prev => prev?.map(n => n.id === id ? { ...n, read: true } : n), { revalidate: false })
mutateUnreadPRData()

// After (tRPC)
await markReadMutation.mutateAsync({ id })
utils.notifications.list.setData({ limit: 50, offset: 0 }, prev => {
  if (!prev) return prev
  return { ...prev, notifications: prev.notifications.map(n => n.id === id ? { ...n, read: true } : n) }
})
mutateUnreadPRData()
```

**All 7 mutation conversions:**

| Callback | tRPC mutation | Optimistic update |
|----------|--------------|-------------------|
| `markNotificationRead(id)` | `trpc.notifications.markRead.useMutation()` | Set `read: true` for matching id |
| `markNotificationUnread(id)` | `trpc.notifications.markUnread.useMutation()` | Set `read: false` for matching id |
| `markNotificationReadByItem(repo, prNumber, commentId?, reviewId?)` | `trpc.notifications.markItemRead.useMutation()` | Set `read: true` for matching repo+prNumber+commentId/reviewId |
| `markAllNotificationsRead()` | `trpc.notifications.markAllRead.useMutation()` | Set all `read: true`, set unreadPR to `EMPTY_UNREAD` |
| `markPRNotificationsRead(repo, prNumber)` | `trpc.notifications.markPRRead.useMutation()` | Set `read: true` for matching repo+prNumber, delete key from unreadPR |
| `deleteNotification(id)` | `trpc.notifications.remove.useMutation()` | Filter out by id |
| `deleteAllNotifications()` | `trpc.notifications.removeAll.useMutation()` | Set to empty array, set unreadPR to `EMPTY_UNREAD` |

**Socket subscriptions stay the same** — they use `subscribe()` from `useSocket()`, not SWR/tRPC. The `notifications:new` handler that updates the list changes from `mutateNotifications(updater)` to `utils.notifications.list.setData(input, updater)`. The `notification:custom` and `refetch` handlers stay identical.

**Socket handler for new notification (line 162-179):**
```ts
// Before
mutateNotifications(prev => {
  if (!prev) return [notification]
  const exists = prev.some(n => (n.dedup_hash && n.dedup_hash === notification.dedup_hash) || n.id === notification.id)
  if (exists) return prev
  return [notification, ...prev]
}, { revalidate: false })
mutateUnreadPRData()

// After
utils.notifications.list.setData({ limit: 50, offset: 0 }, prev => {
  if (!prev) return { notifications: [notification], total: 1 }
  const exists = prev.notifications.some(n => (n.dedup_hash && n.dedup_hash === notification.dedup_hash) || n.id === notification.id)
  if (exists) return prev
  return { notifications: [notification, ...prev.notifications], total: prev.total + 1 }
})
mutateUnreadPRData()
```

**Refetch handler (line 182-186):**
```ts
// Before
if (group === 'notifications') mutateNotifications()
// After
if (group === 'notifications') utils.notifications.list.invalidate()
```

**Badge count:** Derived from `notifications.filter(n => !n.read).length` — unchanged, just reads from tRPC query data instead of SWR.

**Remove:** `import * as api from '../lib/api'` (no more api calls), `import useSWR from 'swr'` (for notifications — still need for unreadPR, see below).

### 13. `src/lib/unreadPR.ts` + Shared cache between NotificationDataContext and GitHubContext

**The problem:** Both `NotificationDataContext` and `GitHubContext` call `useSWR(UNREAD_PR_KEY, fetchUnreadPRData)` with the same key. SWR deduplicates — one fetch, two consumers. NotificationDataContext also does optimistic updates on this cache via `mutateUnreadPRData()`.

**The solution:** The `prUnread` tRPC query now returns the final `Record<string, { count, itemIds }>` shape directly (transform moved server-side). Both contexts switch to `trpc.notifications.prUnread.useQuery()` — react-query deduplicates automatically.

**Changes to NotificationDataContext:**
- Remove `useSWR(UNREAD_PR_KEY, fetchUnreadPRData)`
- Replace with `const { data: unreadPRData = EMPTY_UNREAD } = trpc.notifications.prUnread.useQuery()`
- Optimistic updates change from `mutateUnreadPRData(updater)` to `utils.notifications.prUnread.setData(undefined, updater)`
- `mutateUnreadPRData()` (revalidate) becomes `utils.notifications.prUnread.invalidate()`
- `mutateUnreadPRData(EMPTY_UNREAD, { revalidate: false })` becomes `utils.notifications.prUnread.setData(undefined, EMPTY_UNREAD)`

**Changes to GitHubContext:**
- Remove `useSWR(UNREAD_PR_KEY, fetchUnreadPRData)` import and call
- Replace with `const { data: unreadPRData = EMPTY_UNREAD } = trpc.notifications.prUnread.useQuery()`
- Read-only — no other changes needed

**Delete `src/lib/unreadPR.ts`** entirely. The `EMPTY_UNREAD` constant and `UnreadPRData` type move inline or to the schema. `fetchUnreadPRData` and `UNREAD_PR_KEY` are no longer needed.

### 14. `src/components/PushNotificationModal.tsx` — fetch → tRPC

**Current:** 5 `fetch()` calls to REST endpoints.

**Conversions:**

1. **`/api/push/vapid-key`** (GET, line 65):
   Currently: `const res = await fetch('/api/push/vapid-key'); const { publicKey } = await res.json()`
   Change to: `trpc.notifications.vapidKey.useQuery()` — now in notifications domain. Access `data?.publicKey` reactively instead of fetching inside `handleEnable`.

   The `handleEnable` function currently fetches vapidKey, then subscribes. With tRPC, the vapid key is already available from the query. The function simplifies to:
   ```ts
   const { data: vapidData } = trpc.notifications.vapidKey.useQuery()
   // in handleEnable:
   const sub = await reg.pushManager.subscribe({
     userVisibleOnly: true,
     applicationServerKey: vapidData.publicKey,
   })
   await subscribeMutation.mutateAsync({ endpoint: sub.endpoint, keys: ..., userAgent: ... })
   ```

2. **`/api/push/subscribe`** (POST, line 87):
   Change to: `trpc.notifications.pushSubscribe.useMutation()`
   On success: call `refetch()` (settings refetch) — same as now.

3. **`/api/push/unsubscribe`** (POST, lines 73, 116, 139):
   Change to: `trpc.notifications.pushUnsubscribe.useMutation()`
   Called in 3 places: `handleEnable` (cleanup old sub), `handleDisable`, `handleRemoveDevice`.
   On success: call `refetch()` (settings refetch).

4. **`/api/push/test`** (POST, line 157):
   Change to: `trpc.notifications.pushTest.useMutation()`

5. **`/api/push/test-dismiss`** (POST, line 170):
   Change to: `trpc.notifications.pushTestDismiss.useMutation()`

**Error handling stays the same pattern** — try/catch with `toastRrror`. tRPC mutations throw on error, so the catch blocks work identically.

### 15. `src/types.ts` — Remove notification types

**Remove:**
- Lines 304-327: `NotificationData` interface
- Lines 329-337: `Notification` interface

**Importers to update:**
- `src/context/NotificationDataContext.tsx` line 15: `import type { Notification } from '../types'` → `from '@domains/notifications/schema'`
- `src/components/NotificationList.tsx` line 22: `import type { Notification } from '@/types'` → `from '@domains/notifications/schema'`

No other files import `Notification` or `NotificationData` from `src/types.ts`.

### 16. `shared/types.ts` — Remove UnreadPRNotification

**Remove:** Lines 209-214: `UnreadPRNotification` interface

**Importers:**
- `src/lib/api.ts` line 5: `import { UnreadPRNotification } from '../../shared/types'` — deleted with api functions
- `server/db.ts` line 6: `import type { UnreadPRNotification } from '../shared/types'` — deleted with db functions

No other importers.

### 17. `src/lib/api.ts` — Delete notification section

**Delete:**
- Line 5: `UnreadPRNotification` import from `shared/types` (if no other api functions use it)
- Line 10-16: `Notification` import from `../types` (if no other api functions use it)
- Lines 851-910: All 9 notification fetch wrappers

Check that no remaining api functions reference `Notification` or `UnreadPRNotification` types.

### 18. `src/lib/unreadPR.ts` — Delete

Entire file deleted. The `prUnread` tRPC query now returns the final `Record<string, { count, itemIds }>` shape directly. Both `NotificationDataContext` and `GitHubContext` use `trpc.notifications.prUnread.useQuery()` instead.

Move `EMPTY_UNREAD` constant (`{}`) inline into the contexts or into a shared location if needed (e.g. a small constant in the notifications schema).

### 19. `src/sw.ts` — No changes

Service worker receives push payloads as raw JSON via the browser Push API. Doesn't import any notification modules. Payload shape `{ title, body, tag, action, data }` is unchanged.

## Files Deleted

| File | Reason |
|------|--------|
| `server/notify.ts` | Replaced by `@domains/notifications/service.ts` |
| `server/push.ts` | Replaced by `@domains/notifications/service.ts` |
| `shared/notifications.ts` | Replaced by `@domains/notifications/registry.ts` |
| `server/routes/notifications.ts` | Replaced by tRPC procedures |
| `server/routes/settings.ts` | Replaced by tRPC procedures (only had push endpoints) |

## Lines Deleted From Existing Files

| File | Lines | What |
|------|-------|------|
| `server/db.ts` | 6 | `UnreadPRNotification` import |
| `server/db.ts` | 893 | `getOrCreateVapidKeys` re-export (points to notifications domain now) |
| `server/db.ts` | 897-1070 | `Notification` interface + 10 DB functions |
| `src/types.ts` | 304-337 | `NotificationData` + `Notification` interfaces |
| `shared/types.ts` | 209-214 | `UnreadPRNotification` interface |
| `src/lib/api.ts` | 5, 851-910 | `UnreadPRNotification` import + 9 fetch wrappers |

## Execution Order

1. ~~**Server import swaps:** `index.ts`, `workspace/emit.ts`, `github/checks.ts`, `listen.ts`, `pty/manager.ts`, `ws/terminal.ts` — change imports to `@domains/notifications/*`~~ ✅
2. ~~**Delete old server files:** `server/notify.ts`, `server/push.ts`~~ ✅
3. ~~**Clean `server/db.ts`:** Remove `Notification` interface, 10 notification functions, `UnreadPRNotification` import, `getOrCreateVapidKeys` re-export~~ ✅
4. ~~**Client import swaps (no logic change):** `NotificationContext.tsx`, `ProcessContext.tsx`, `useNotificationSubscriptions.ts`, `NotificationList.tsx` — change `shared/notifications` → `@domains/notifications/registry`, `@/types` → `@domains/notifications/schema`~~ ✅
5. ~~**Rewrite `NotificationDataContext.tsx`** — SWR → tRPC for both notifications list and unreadPR, swap all `api.*` calls for tRPC mutations, update optimistic cache logic from `mutate()` to `utils.notifications.*.setData()`~~ ✅
6. ~~**Rewrite `GitHubContext.tsx`** — swap SWR unreadPR for `trpc.notifications.prUnread.useQuery()`~~ ✅
7. ~~**Rewrite `PushNotificationModal.tsx`** — 5 fetch calls → tRPC queries/mutations~~ ✅
8. ~~**Delete `src/lib/unreadPR.ts`**~~ ✅
9. ~~**Delete from `src/lib/api.ts`** — notification functions + imports~~ ✅
10. ~~**Delete types** from `src/types.ts` and `shared/types.ts`~~ ✅
11. ~~**Delete `shared/notifications.ts`**~~ ✅
12. ~~**Delete `server/routes/notifications.ts` and `server/routes/settings.ts`**, remove registrations from `server/index.ts`~~ ✅
13. ~~**Run `npm run lint:fix && npm run check`**~~ ✅
