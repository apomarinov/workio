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

## UI

- Always use available shadcn components from `src/components/ui/` (Dialog, Button, Input, Popover, Card, Switch, etc.).
- Icons come from `lucide-react`.
- Toast notifications use `sonner` via `import { toast } from '@/components/ui/sonner'`.
