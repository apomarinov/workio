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

## Keyboard Shortcuts

To add a new shortcut:

1. **`src/types.ts`** — Add entry to `Keymap` interface and `DEFAULT_KEYMAP` with the default binding. Digit-based shortcuts (like `goToTab`) use modifier-only bindings (e.g. `{ altKey: true }`); key-based shortcuts include `key` (e.g. `{ metaKey: true, key: '[' }`).
2. **`src/hooks/useKeyboardShortcuts.tsx`** — Add handler to `KeymapHandlers` interface, resolve the binding from settings (same pattern as existing ones), add detection logic in `handleKeyDown` (key-match for regular shortcuts, digit-match for index-based), and add to the `useEffect` dependency array.
3. **`src/App.tsx`** — Add handler implementation in the `useKeyboardShortcuts({...})` call. **Use refs** (`activeTerminalRef`, `activeShellsRef`, `terminalsRef`) instead of direct state — the handler closures are stale since they're stored in a ref inside the hook.
4. **`src/components/KeymapModal.tsx`** — Wire up in all places: `ShortcutName` union, `useState`, `useEffect` sync from settings, `finalize` in recording, `handleSave`, `handleReset`, `handleDiscardChanges`, `hasUnsavedChanges`, `findDuplicates`, and add a `<ShortcutRow>` in the UI.
5. If the shortcut changes state that the sidebar also tracks (e.g. active shell), **dispatch a custom event** (e.g. `shell-select`) so sidebar components stay in sync.
