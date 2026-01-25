# Project Plan — Terminal Session Manager (React + Node + WebSockets + PTY)

## Goal
Build a desktop-like web app (served by a single Node process) that:
- Shows a sidebar list of sessions (Claude Code / shells / zellij, etc.)
- Lets you create/kill sessions
- Displays **one active embedded terminal** (xterm.js) connected to the selected session
- Streams PTY output to the browser via WebSockets
- Persists sessions + metadata in SQLite

## Tech Stack
**Frontend**
- React + Vite
- Tailwind CSS
- shadcn/ui
- lucide-react icons
- xterm.js (+ addons: fit, web-links, search optional)

**Backend**
- Node.js server: **Fastify** (or Express)
- WebSockets (`ws`)
- node-pty for PTY sessions
- SQLite (via `sqlite3`)

---

## High-Level Architecture

### Data Flow
1. UI requests “create session” → REST endpoint
2. Server spawns PTY process (shell or `zellij`) and stores metadata in SQLite
3. UI opens a WebSocket for the session (`/ws?sessionId=...`)
4. Server streams PTY output bytes → WS → xterm.js
5. UI sends keystrokes/resize events → WS → PTY

### Single Active Terminal Model
- The browser renders **one** xterm instance.
- Switching sessions = detach current WS + attach to another session's WS.
- PTYs continue running server-side even when not attached.

---

## Directory Structure

```
app/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── server/
│   ├── index.ts              # Fastify server entry
│   ├── db.ts                 # SQLite connection + queries
│   ├── pty-manager.ts        # PTY lifecycle management
│   ├── routes/
│   │   └── sessions.ts       # REST endpoints for sessions
│   └── ws/
│       └── terminal.ts       # WebSocket handler
├── src/
│   ├── main.tsx              # React entry
│   ├── App.tsx               # Root component + routing
│   ├── components/
│   │   ├── HomePage.tsx      # Welcome + create first session
│   │   ├── Sidebar.tsx       # Session list
│   │   ├── SessionItem.tsx   # Single session row
│   │   ├── Terminal.tsx      # xterm.js wrapper
│   │   └── ui/               # shadcn components
│   ├── hooks/
│   │   ├── useWebSocket.ts   # WS connection hook
│   │   └── useSessions.ts    # Session CRUD hook
│   ├── lib/
│   │   └── api.ts            # REST client
│   └── types.ts              # Shared types
└── public/
```

---

## Database Schema

Uses the existing `data.db` SQLite database. Add a new table for terminal sessions:

```sql
CREATE TABLE IF NOT EXISTS terminal_sessions (
    id TEXT PRIMARY KEY,           -- UUID
    project_id INTEGER UNIQUE,     -- FK to projects table (1 session per project)
    name TEXT,                      -- User-defined or auto-generated
    pid INTEGER,                    -- PTY process ID (null if dead)
    status TEXT DEFAULT 'running', -- running | stopped
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_status ON terminal_sessions(status);
```

---

## API Endpoints

### REST (Fastify)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all terminal sessions |
| POST | `/api/sessions` | Create session `{ name?, cwd }` — upserts project by cwd, returns existing session if one exists for that project, else creates new |
| GET | `/api/sessions/:id` | Get session details |
| DELETE | `/api/sessions/:id` | Kill PTY and delete session |
| PATCH | `/api/sessions/:id` | Update session (rename) |

### WebSocket

**Endpoint:** `ws://localhost:3000/ws?sessionId=<id>`

**Client → Server messages:**
```typescript
{ type: 'input', data: string }      // Keystrokes
{ type: 'resize', cols: number, rows: number }
```

**Server → Client messages:**
```typescript
{ type: 'output', data: string }     // PTY output
{ type: 'exit', code: number }       // PTY exited
{ type: 'error', message: string }
```

---

## Package Dependencies

```json
{
  "dependencies": {
    "@fastify/static": "^7.0.0",
    "@fastify/websocket": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0",
    "node-pty": "^1.0.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@types/uuid": "^10.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0",
    "xterm-addon-web-links": "^0.9.0",
    "lucide-react": "^0.400.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

---

## UI Flow

```
┌─────────────────────────────────────────────────────────┐
│                      App Load                            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │ Has sessions? │
                  └───────────────┘
                    │           │
                   No          Yes
                    │           │
                    ▼           ▼
            ┌───────────┐  ┌─────────────────────────────┐
            │ HomePage  │  │        Main App UI          │
            │           │  │ ┌─────────┬───────────────┐ │
            │ Welcome   │  │ │ Sidebar │   Terminal    │ │
            │ message + │  │ │         │   (active     │ │
            │ Create    │  │ │ Session │   session)    │ │
            │ Session   │  │ │ List    │               │ │
            │ form      │  │ │         │               │ │
            └───────────┘  │ └─────────┴───────────────┘ │
                           └─────────────────────────────┘
```

## Frontend Components

### App.tsx
- Fetches sessions on mount
- If no sessions → render `<HomePage>`
- If sessions exist → render main layout (Sidebar + Terminal)
- Tracks `activeSessionId` state (defaults to first session)

### HomePage.tsx
- Centered welcome message
- "Create your first session" form
- Input for `cwd` path (with folder picker or text input)
- Optional name field
- On submit → creates session → redirects to main UI

### Sidebar.tsx
- Fixed width left panel
- Maps sessions to `<SessionItem>`
- "New Session" button at bottom
- Click to select, shows active state

### SessionItem.tsx
- Displays name (or cwd basename if no name)
- Status indicator (running/stopped)
- Delete button (with confirmation)
- Rename on double-click

### Terminal.tsx
- Mounts xterm.js on `<div ref>`
- Uses `FitAddon` for auto-resize
- Connects to WebSocket when `sessionId` prop changes
- Sends input/resize events, receives output

### useWebSocket.ts
```typescript
function useWebSocket(sessionId: string | null, onOutput: (data: string) => void) {
  // Connect/disconnect on sessionId change
  // Return { send, isConnected }
}
```

---

## Implementation Phases

### Phase 1: Project Skeleton
1. Initialize Vite + React + TypeScript in `app/`
2. Configure Tailwind CSS
3. Set up Fastify server with static file serving
4. Add npm scripts: `dev` (concurrent server + vite), `build`, `start`

### Phase 2: Database + REST API
1. Create `server/db.ts` connecting to existing `../data.db`
2. Add `terminal_sessions` table migration
3. Implement CRUD routes in `server/routes/sessions.ts`
4. Test with curl/httpie

### Phase 3: PTY Manager
1. Create `server/pty-manager.ts` with Map<sessionId, IPty>
2. Implement spawn/kill/write/resize methods
3. Handle PTY exit events (update DB status)

### Phase 4: WebSocket Integration
1. Add `@fastify/websocket` plugin
2. Route `/ws?sessionId=` to terminal handler
3. Attach/detach PTY streams to WS connections
4. Handle reconnection (replay last N bytes optional)

### Phase 5: Frontend UI
1. Build Sidebar + SessionItem components
2. Integrate xterm.js in Terminal component
3. Wire up useWebSocket hook
4. Style with Tailwind + shadcn/ui

### Phase 6: Polish
1. Add loading states and error handling
2. Persist terminal scrollback (optional)
3. Add keyboard shortcuts (Ctrl+Shift+T new, Ctrl+Shift+W close)
4. Dark/light theme support
