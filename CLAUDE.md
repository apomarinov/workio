# CLAUDE.md

## Database

- No migrations. Modify `schema.sql` directly.
- If adding/removing columns, update the `CREATE TABLE` statement in `schema.sql` and recreate the database.

## Linting & Type Checking

- After substantial changes in `/app`, always run:
  ```
  npm run lint:fix && npm run check
  ```
- `lint:fix` runs Biome auto-fix on `src/` and `server/`.
- `check` runs Biome lint + TypeScript typecheck (both `tsconfig.json` and `tsconfig.node.json`).

## Error Handling

- **Never silently swallow errors** in catch blocks.
- **Server**: Always log errors using the project logger (`log.error(...)` from `../logger`).
- **Client (queries)**: Show an error toast on failure — `toast.error('Failed to ...')`. No need for `console.error` if showing a toast.
- **Client (mutations)**: Show an error toast on failure **and** a success toast on success — `toast.success('...')`. No need for `console.error` if showing a toast.

## Server Code

- **Never use `execSync` or `execFileSync`** — they block the event loop and cause choppy terminal input.
- Always use async `execFile` wrapped in a Promise or via `promisify`:
  ```typescript
  import { execFile } from 'node:child_process'

  function myCommand(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('cmd', ['arg1', 'arg2'], { timeout: 5000 }, (err, stdout) => {
        if (err) return reject(err)
        resolve(stdout.trim())
      })
    })
  }
  ```

## Types

- **Before defining any type**, check if it already exists in `shared/types.ts` or `src/types.ts`.
- Client-only types: `src/types.ts`
- Shared types (client + server): `shared/types.ts`
- **Never duplicate type definitions** across files. Always import from the designated type files.
- Component props interfaces (e.g., `FooProps`) are OK to keep local to their component file.
- Utility functions go in `src/lib/`, not in type files.

## React

- This project uses **React Compiler** — do not use `useMemo`, `useCallback`, or `React.memo` manually. The compiler handles memoization automatically.

## UI

- Always use available shadcn components from `src/components/ui/` (Dialog, Button, Input, Popover, Card, Switch, etc.).
- Icons come from `lucide-react`.
- Toast notifications use `sonner` via `import { toast } from '@/components/ui/sonner'`.
- For confirmation dialogs (discard, delete, destructive actions), use `ConfirmModal` from `src/components/ConfirmModal.tsx` instead of raw `AlertDialog` primitives.
- For collapsible sections, use a single `ChevronDown` with animated rotation:
  ```tsx
  <ChevronDown className={cn('w-3 h-3 transition-transform', !expanded && '-rotate-90')} />
  ```
  Do **not** swap between `ChevronRight` / `ChevronDown` — use one icon with `-rotate-90`.

## Keyboard Shortcuts

Uses `react-hotkeys-hook` (v5) for key detection. Key names in `DEFAULT_KEYMAP` use `event.code`-based names (e.g. `bracketleft` not `[`, `comma` not `,`). The `bindingToHotkeyString()` utility converts bindings to react-hotkeys-hook format. `CODE_TO_DISPLAY` maps code names back to display characters for the UI.

To add a new shortcut:

1. **`src/types.ts`** — Add entry to `Keymap` interface and `DEFAULT_KEYMAP` with the default binding. Digit-based shortcuts (like `goToTab`) use modifier-only bindings (e.g. `{ altKey: true }`); key-based shortcuts include `key` using `event.code`-based name (e.g. `{ altKey: true, key: 'bracketleft' }`). If the key has a non-obvious display form, add it to `CODE_TO_DISPLAY`.
2. **`src/hooks/useKeyboardShortcuts.tsx`** — Add handler to `KeymapHandlers` interface, resolve the binding via `resolveBinding()`, add a `useHotkeys()` call using `bindingToHotkeyString()` with `HOTKEY_OPTS` (capture phase, enableOnFormTags, preventDefault). Check `disabledRef.current` at the start of the callback. Call `e.stopPropagation()` before invoking the handler.
3. **`src/App.tsx`** — Add handler implementation in the `useKeyboardShortcuts({...})` call. **Use refs** (`activeTerminalRef`, `activeShellsRef`, `terminalsRef`) instead of direct state — the handler closures are stale since they're stored in a ref inside the hook.
4. **`src/components/KeymapModal.tsx`** — Add a `<ShortcutRow>` using the `bindings` state object and `setBinding(name, value)` helper. Recording uses `mapEventCode(e.code)` for code-based key names.
5. If the shortcut changes state that the sidebar also tracks (e.g. active shell), **dispatch a custom event** (e.g. `shell-select`) so sidebar components stay in sync.

## Database access

Use the db env from .env.local to access the DB