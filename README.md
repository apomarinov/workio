# WorkIO

<p align="center">
  <img src="app/public/hero.png" alt="WorkIO Dashboard" />
</p>

A developer dashboard that brings together your projects, terminals, Claude AI sessions, and GitHub pull requests into a single interface. Manage multiple projects, monitor what Claude is doing, track PRs, connect to remote machines, use it on your phone — all from one place.

## Features

### Projects
- Clone Git repositories
- Use `conductor.json` or individual setup/teardown scripts
- Add additional workspaces for a project using Git worktrees

### Terminals
- Start terminals locally or over SSH
- Multiple shell tabs per terminal with drag-and-drop reordering
- Shell integration for command tracking and Claude session linking
- View all processes and listening ports in your terminal
- Get notified for command completion
- Shell templates and custom commands
- Multi-client support with device indicators
- Open projects in Cursor/VSCode

### Claude Code
- View all running Claude sessions on your system
- View sessions started in your projects
- Tool visualization — see Bash, Edit, Read, Write tool calls with diffs
- Permission prompt detection and notifications
- Search across all session messages
- Star/favorite sessions
- Resume sessions in specific shells
- Move sessions between projects
- Pin sessions in an always-on-top Picture-in-Picture window

### GitHub PRs
- PR updates via `gh` CLI polling or real-time repo webhooks (ngrok)
- View PR status of the current branch in your project
- View PR list of all repos you have projects in
- View reviews, comments, running/failed checks
- Create PRs with diff viewer and conflict detection
- Merge, close, edit title/description
- Re-request reviews, rerun failed checks
- Emoji reactions on comments and reviews
- Involved PRs — PRs where you're mentioned or review-requested
- Filter and silence authors

### Git
- Changes at a glance with dirty status tracking
- Pull, push, checkout, merge, rebase branches
- Commit dialog with file picker, diff viewer, staged/unstaged management
- Remote sync — shows ahead/behind commit counts
- Create and manage worktrees

### Command Palette
Access everything with `Cmd+K` — multiple modes:
- Search: jump to sessions, terminals, branches
- Session search: search message content across sessions
- Actions: git operations, PR actions
- Custom commands: user-defined terminal shortcuts
- PR checkout: switch to PR branches
- Branch sessions: see Claude sessions on specific branches

### Notifications
- Claude permission requests and session completions
- PR activity (reviews, comments, checks)
- Project setup status
- Web push notifications (self-hosted with VAPID keys)
- Click to navigate to the relevant terminal/shell

### Mobile
- Responsive design for phones and tablets
- Custom mobile terminal keyboard with action buttons
- Drag-and-drop button reordering
- Installable as a PWA

### Zellij Integration
- Copy to clipboard for multi-page selections in panes
- Detect running processes in tabs
- Map project to session with `--session-name "$(wiosession)"`

### Keyboard Shortcuts
- Fully customizable key bindings
- Configurable via the settings modal

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Terminal | xterm.js, node-pty, WebGL renderer |
| Backend | Fastify, Socket.IO |
| Database | PostgreSQL (direct SQL, no ORM) |
| Hooks | Python daemon for Claude Code lifecycle events |
| Real-time | Socket.IO channels + WebSocket per shell for PTY I/O |

---

## Prerequisites

Before running WorkIO, make sure the following are installed on your machine:

- **Node.js** (version specified in `app/.nvmrc`)
- **PostgreSQL** (server running, with `psql` client available)
- **Python 3.10+**
- **Claude CLI** — install from [Anthropic's docs](https://docs.anthropic.com/en/docs/claude-code)
- **GitHub CLI (`gh`)** — install from [cli.github.com](https://cli.github.com/) (optional, for PR features)
- **Git** and **SSH** (for repository and remote machine features)

You also need to set up environment variables. Create a `.env.local` file in the project root:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g., `postgresql://localhost/workio`) |
| `NGROK_AUTHTOKEN` | No | Enables GitHub webhook support for real-time PR updates. Get a token from [ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken). Without this, PR data only refreshes on interval poll and manual actions. |
| `NGROK_DOMAIN` | No | Use a static ngrok domain instead of a random URL. Requires `NGROK_AUTHTOKEN`. Get a free static domain from your [ngrok dashboard](https://dashboard.ngrok.com/domains). |

---

## Quick Start

```bash
./run.sh
```

This script handles everything: checks dependencies, adds Claude hooks, sets up the database, builds the app, and starts the server. The dashboard will be available at `http://localhost:5175`.

**Flags:**

- `./run.sh --rebuild` — Force a fresh `npm install` and rebuild
- `./run.sh --drop-db` — Drop and recreate the database from scratch

---

## Development

```bash
cd app
npm install
npm run dev
```

This starts two processes in parallel:

- A backend server on port **5176** (with automatic reload on file changes)
- A frontend dev server on port **5175** (with hot module replacement)

Open `https://localhost:5175` in your browser.

**Other useful commands:**

```bash
npm run lint:fix    # Auto-fix lint and formatting issues
npm run check       # Run linting + TypeScript type checking
npm run build       # Production build
npm start           # Start the production server
```

---

## Architecture

```
┌─────────────┐    Socket.IO     ┌──────────────┐     SQL      ┌────────────┐
│   React UI  │ ◄──────────────► │   Fastify    │ ◄──────────► │ PostgreSQL │
│  (Vite PWA) │    WebSocket     │   Server     │              └────────────┘
└─────────────┘   (PTY I/O)      └──────┬───────┘                    ▲
                                        │                            │
                                        │ spawns                     │
                                        ▼                            │
                                 ┌──────────────┐    NOTIFY          │
                                 │ Python Daemon │ ──────────────────┘
                                 │ (Claude Hooks)│
                                 └──────────────┘
```

- **React frontend** communicates with the Fastify backend over Socket.IO for real-time events (git status, processes, PR checks, Claude hooks) and a dedicated WebSocket per shell for terminal I/O.
- **Fastify backend** manages PTY sessions, runs git/gh commands, and serves the API.
- **Python monitor daemon** listens for Claude Code hook events via a Unix socket, processes tool calls, and writes to PostgreSQL. The server is notified of changes via `NOTIFY`/`LISTEN`.
- **ngrok tunnel** (optional) exposes a webhook endpoint for real-time GitHub PR updates.
