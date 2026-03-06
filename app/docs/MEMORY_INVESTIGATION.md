# Memory & CPU Investigation (4.5 GB / 37.5% CPU)

## Architecture

- **Not Electron** — Fastify + React web app. The 4.5 GB is the browser tab.
- **Server**: Fastify with PTY worker processes (node-pty via `child_process.fork()`)
- **Client**: React 19 + Vite, xterm.js with WebGL addon, SWR for data fetching, Socket.IO + native WebSocket for real-time
- PTYs and scrollback buffers live on the server. The client renders terminal output via xterm.js.

## High-Impact Issues

### 1. Hidden shells are fully mounted in DOM

**`app/src/App.tsx:761-812`**

All non-suspended shells render full `<Terminal>` components, hidden only with CSS `invisible`. Each keeps its xterm instance, event listeners, and WebSocket connection alive:

```tsx
{t.shells.map((shell) => {
  if (shell.isSuspended && shell.id !== activeShellId) return null
  return <Terminal key={shell.id} ... />  // mounted even when not visible
})}
```

Only suspended shells are filtered out. Every other shell stays fully instantiated.

### 2. xterm.js scrollback: 50,000 lines per terminal

**`app/src/components/Terminal.tsx:385`**

```typescript
scrollback: 50000
```

Each xterm instance holds up to 50k lines in browser memory. Combined with issue #1, every hidden shell carries this buffer.

### 3. Global event listeners multiply per terminal

**`app/src/components/Terminal.tsx:277-360`**

Every `<Terminal>` instance attaches 6+ listeners to `window`/`document`:

- `window`: `claim-primary`, `release-primary`, `terminal-paste`, `terminal-focus`, `keydown`
- `document`: `mousemove`

With N mounted terminals, every keypress and mouse move fires through all N listener sets.

### 4. Scroll handlers not cleaned up

**`app/src/components/Terminal.tsx:448-711`**

`wheel`, `touchstart`, `touchmove`, `touchend` listeners are attached to `xterm-screen` elements but the cleanup at line 973 only calls `terminal.dispose()` — it does **not** remove these handlers explicitly.

### 5. GitHub PR data: deeply nested, duplicated on every render

**`app/src/context/TerminalContext.tsx:302-518`**

Full GraphQL PR data (reviews, comments, threads with nested comments, reactions with user lists) stored in state. The enrichment layer at lines 474-518 duplicates the entire structure via `.map()` + spread every time `unreadPRData` changes:

```typescript
const enrichedGithubPRs = useMemo(() => {
  return githubPRs.map((pr) => ({
    ...pr,
    comments: pr.comments.map(markComment),
    reviews: pr.reviews.map((r) => ({ ...r, reactions: ... })),
    discussion: pr.discussion.map((item) => ({ ...item, ... }))
  }))
}, [githubPRs, unreadPRData])
```

### 6. GitHub PR polling every 60s with unbounded caches

**`app/server/github/checks.ts:29-62, 1395`**

Four server-side `Map` caches grow without eviction:

- `repoCache` (line 29)
- `monitoredTerminals` (line 40)
- `lastPRData` (line 59)
- `checkFailedOnCommit` (line 62)

Closed/merged PRs are never removed. GraphQL queries fire every 60 seconds.

### 7. Session messages accumulate unbounded

**`app/src/hooks/useSessionMessages.ts:55-98`**

Messages are prepended (real-time) and appended (infinite scroll) to a growing array, never pruned:

```typescript
// Real-time: prepend
setAllMessages((prev) => {
  const result = [...prev]
  for (const msg of data.messages) {
    result.unshift(msg)
  }
  return result
})

// Infinite scroll: append
setAllMessages((prev) => {
  const newMessages = result.messages.filter(...)
  return [...prev, ...newMessages]
})
```

Messages containing tool outputs and diffs can be 10-50 KB each.

### 8. SWR cache has no size limits

**`app/src/context/SessionContext.tsx:50`, `app/src/context/TerminalContext.tsx:107, 523-527`**

No `SWRConfig` wrapper in `main.tsx` to set global cache limits. Every SWR key stores its full response indefinitely.

## Medium-Impact Issues

### 9. Notification array grows unbounded

**`app/src/context/TerminalContext.tsx:541`**

```typescript
mutateNotifications((prev) => [notification, ...prev])
```

No maximum size limit on the notifications array.

### 10. Pending writes buffer while terminal hidden

**`app/src/components/Terminal.tsx:61`**

Data queues in `pendingWritesRef` while a terminal is hidden. Flushed on visibility, but if a terminal stays hidden with heavy I/O for a long time, this grows.

### 11. Worker output buffer on server

**`app/server/pty/worker.ts:24`**

Each worker holds a `string[]` buffer that accumulates until the shell exits. `MAX_BUFFER_LINES = 5000` (line 18) but not enforced during active streaming.

### 12. Merged & involved PR fetching

**`app/src/context/TerminalContext.tsx:888-967`**

Up to 100 merged PRs + 100 involved PRs fetched and stored in React state.

## Browser Overhead

A significant portion of the 4.5 GB is browser internals — renderer process, GPU process (WebGL contexts), V8 heap overhead, layout trees, compositing layers. A complex SPA like this can easily be 2-3 GB of browser overhead alone. The macOS "Memory Footprint" metric includes all of this.

## Recommended Fixes (by impact)

1. **Dispose hidden terminals** — unmount `<Terminal>` components when not visible instead of CSS hiding, or at minimum dispose the xterm instance
2. **Reduce scrollback** from 50,000 to 5,000-10,000 lines
3. **Add SWR cache limits** via `SWRConfig` provider (e.g., 5-minute TTL, max entries)
4. **Cap session messages** — keep only last 200 loaded, discard older on scroll
5. **Evict closed PR data** — remove from caches after merge/close
6. **Cap notifications** at last 100 items
7. **Clean up scroll listeners** in Terminal.tsx cleanup function
8. **Deduplicate PR enrichment** — avoid full object spread on every render
