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

## UI

- Always use available shadcn components from `src/components/ui/` (Dialog, Button, Input, Popover, Card, Switch, etc.).
- Icons come from `lucide-react`.
- Toast notifications use `sonner` via `import { toast } from '@/components/ui/sonner'`.
