# Terminal Input Lag Analysis

Investigation into choppy keyboard input in the web terminal. Output rendering and general responsiveness are fine — only typing input feels laggy.

## Root Causes

### 1. TerminalContext re-renders every 3 seconds (high impact)

The `Terminal` component consumes `useTerminalContext()` (`Terminal.tsx:20`), so it re-renders whenever the context value changes. The context includes `processes`, `terminalPorts`, and `gitDirtyStatus` in its `useMemo` dependency array (`TerminalContext.tsx:409-450`), but these update frequently from server polling:

- **Process polling**: every **3 seconds** (`server/pty/manager.ts:150`)
- **Git dirty polling**: every **10 seconds** (`server/pty/manager.ts:273`)

Every time `processes` or `gitDirtyStatus` changes, the entire context value is recreated, forcing **all consumers** to re-render — including Terminal, which only needs `activeTerminal` and `selectTerminal`. The Terminal component itself is lightweight to reconcile, but if a keystroke event coincides with React reconciliation, it gets delayed. At a 3-second interval, fast typing will regularly collide with these re-renders, creating periodic hitches.

### 2. Unthrottled ResizeObserver (medium-high impact)

`Terminal.tsx:271-282`:

```typescript
const resizeObserver = new ResizeObserver(() => {
  fitAddonRef.current.fit()        // expensive - measures fonts, recalculates grid
  terminalRef.current.resize(...)   // xterm internal resize
  setDimensions({ cols, rows })     // React state update → re-render
  sendResizeRef.current(cols, rows) // WebSocket message
})
```

No debouncing. If anything causes continuous small layout changes (flex recalculations, scrollbar appearing/disappearing, panel resizes from the resizable columns feature), this fires on every pixel change, each time doing font measurement + React state update + WebSocket send.

### 3. Unthrottled mousemove listener (low-medium impact)

`Terminal.tsx:101-112`:

```typescript
useEffect(() => {
  const handler = (e: MouseEvent) => {
    cursorRef.current = { x: e.clientX, y: e.clientY }
    if (copyBtnRef.current) {
      copyBtnRef.current.style.left = `${e.clientX}px`
      copyBtnRef.current.style.top = `${e.clientY}px`
    }
  }
  document.addEventListener('mousemove', handler)
  return () => document.removeEventListener('mousemove', handler)
}, [])
```

Global `document` listener fires hundreds of times per second. When `copyBtnRef.current` is null (the common case), it's just a ref assignment — negligible. But when the copy button is visible, it does direct DOM style manipulation on every mouse move with no throttle.

### 4. No input batching (low impact)

`useTerminalSocket.ts:210-217`:

Every keystroke is individually JSON-serialized and sent as a separate WebSocket frame. The echo round-trip is: keystroke → WebSocket → server → PTY → output batcher (4ms delay) → WebSocket → client → `terminal.write()`. Not the primary cause of choppiness, but adds baseline latency. Output is batched at 4ms on the server side, but input has no equivalent batching.

### 5. React state updates in keyboard handlers (low impact)

`Terminal.tsx:220-224`:

`setPendingCopy(null)` is called from the custom key handler when Escape is pressed while a copy button is visible. Only fires in that specific scenario.

## Input Data Flow

```
Keystroke
  → xterm.js onData (Terminal.tsx:265-268)
  → sendInputRef.current(data)
  → JSON.stringify({ type: 'input', data }) over WebSocket (useTerminalSocket.ts:215)
  → server receives, writes to PTY (server/ws/terminal.ts:171-178)
  → PTY echoes output
  → server batches output at 4ms (server/ws/terminal.ts:74-98)
  → JSON.stringify({ type: 'output', data }) over WebSocket
  → client onData → terminal.write(data)
```

## Recommended Fixes

### Fix 1: Split TerminalContext (high impact)

Move `processes`, `terminalPorts`, and `gitDirtyStatus` into a separate context so the Terminal component doesn't re-render when they change. Terminal only needs `activeTerminal` and `selectTerminal`.

### Fix 2: Debounce ResizeObserver (medium-high impact)

Wrap the ResizeObserver callback in `requestAnimationFrame` or a ~100ms debounce:

```typescript
const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(() => {
    if (fitAddonRef.current && terminalRef.current) {
      fitAddonRef.current.fit()
      const cols = terminalRef.current.cols + plusCols
      const rows = terminalRef.current.rows
      terminalRef.current.resize(cols, rows)
      setDimensions({ cols, rows })
      sendResizeRef.current(cols, rows)
    }
  })
})
```

### Fix 3: Throttle mousemove handler (low-medium impact)

Use `requestAnimationFrame` to throttle:

```typescript
useEffect(() => {
  let rafId: number | null = null
  const handler = (e: MouseEvent) => {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      cursorRef.current = { x: e.clientX, y: e.clientY }
      if (copyBtnRef.current) {
        copyBtnRef.current.style.left = `${e.clientX}px`
        copyBtnRef.current.style.top = `${e.clientY}px`
      }
      rafId = null
    })
  }
  document.addEventListener('mousemove', handler)
  return () => {
    document.removeEventListener('mousemove', handler)
    if (rafId !== null) cancelAnimationFrame(rafId)
  }
}, [])
```

### Fix 4: Batch input (low impact, optional)

Accumulate keystrokes for ~5ms before sending, similar to how output is batched:

```typescript
const sendInput = useCallback((data: string) => {
  inputBuffer.push(data)
  if (!inputTimer) {
    inputTimer = setTimeout(() => {
      ws.send(JSON.stringify({ type: 'input', data: inputBuffer.join('') }))
      inputBuffer = []
      inputTimer = null
    }, 5)
  }
}, [])
```

## Key Files

| File | Lines | Description |
|------|-------|-------------|
| `app/src/components/Terminal.tsx` | 101-112 | Unthrottled mousemove listener |
| `app/src/components/Terminal.tsx` | 217-249 | Custom key event handler with state updates |
| `app/src/components/Terminal.tsx` | 265-268 | xterm onData → sendInput (no batching) |
| `app/src/components/Terminal.tsx` | 271-282 | Unthrottled ResizeObserver |
| `app/src/hooks/useTerminalSocket.ts` | 210-217 | WebSocket sendInput (no batching) |
| `app/src/context/TerminalContext.tsx` | 315-343 | Process WebSocket subscription (frequent updates) |
| `app/src/context/TerminalContext.tsx` | 409-450 | Context useMemo with processes/ports/dirty in deps |
| `app/server/pty/manager.ts` | 150 | Process polling interval (3s) |
| `app/server/pty/manager.ts` | 273 | Git dirty polling interval (10s) |
| `app/server/ws/terminal.ts` | 74-98 | Output batching (4ms) |
