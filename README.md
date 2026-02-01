# Claude Dashboard

A developer dashboard that brings together your terminals, Claude AI sessions, and GitHub pull requests into a single interface. Manage multiple projects, monitor what Claude is doing, track PRs, and connect to remote machines -- all from one place.

---

## Prerequisites

Before running Claude Dashboard, make sure the following are installed on your machine:

- **Node.js** (version specified in `app/.nvmrc`)
- **PostgreSQL** (server running, with `psql` client available)
- **Python 3.10+**
- **Claude CLI** -- install from [Anthropic's docs](https://docs.anthropic.com/en/docs/claude-code)
- **GitHub CLI (`gh`)** -- install from [cli.github.com](https://cli.github.com/) (optional, but needed for PR features)
- **Git** and **SSH** (for repository and remote machine features)

You also need a `DATABASE_URL` environment variable pointing to your PostgreSQL instance. Set it in `.env.local` file in the project root:

```
DATABASE_URL=postgresql://localhost/claude_dashboard
```

---

## Running in Production

The quickest way to get started:

```bash
./run.sh
```

This script handles everything: checks dependencies, sets up the database, builds the app, and starts the server. The dashboard will be available at `http://localhost:5175`.

**Flags:**

- `./run.sh --rebuild` -- Force a fresh `npm install` and rebuild
- `./run.sh --drop-db` -- Drop and recreate the database from scratch

## Running for Development

```bash
cd app
npm install
npm run dev
```

This starts two processes in parallel:

- A backend server on port **5176** (with automatic reload on file changes)
- A frontend dev server on port **5175** (with hot module replacement)

Open `http://localhost:5175` in your browser.

**Other useful commands:**

```bash
npm run lint:fix    # Auto-fix lint and formatting issues
npm run check       # Run linting + TypeScript type checking
npm run build       # Production build
npm start           # Start the production server
```

---

## Features

### Terminals

Create and manage multiple terminals from the dashboard. Each terminal runs a real shell session (bash, zsh, etc.) with full color support, clickable links, and proper resize handling. You can name your terminals, organize them by folder or by Claude session, and drag-and-drop to reorder them. Terminals remember their working directory and can be cloned or deleted when you're done. There's also custom tweaks for zellij users.

### SSH Terminals

Connect to remote machines directly from the dashboard. Claude Dashboard reads your `~/.ssh/config` file and lets you pick a host when creating a new terminal. You can browse remote directories, run commands, and work with remote git repos -- all without leaving the dashboard.

### Claude Sessions

View your Claude AI sessions and their full conversation history. See what Claude is thinking, what tools it's using, and what it's producing. Messages are displayed with rich formatting including syntax-highlighted code, math equations, and inline images. You can filter the view to show or hide Claude's thinking process, tool calls, and tool output. Sessions are organized by project and show their current status (active, waiting for permission, done, etc.).

### GitHub Pull Requests

Track the status of pull requests across all your open terminals. The dashboard automatically detects which git branch each terminal is on and shows the associated PR status: whether it's been approved, has changes requested, has passing or failing checks, or has merge conflicts. You can see reviewer avatars, read PR comments, request reviews, and merge PRs (with merge, squash, or rebase options) -- all without switching to a browser.

A notification bell in the sidebar alerts you when there's new activity on your PRs.

### Merged PRs

Browse a history of recently merged pull requests grouped by repository. This gives you a quick way to see what's been shipped lately.

### Command Palette

Press **Cmd+K** to open a Spotlight-style search that lets you quickly jump to any terminal, Claude session, or pull request. Results show relevant details like git branches and PR statuses. Select an item and get context-sensitive actions like opening a PR in the browser, merging, or viewing a session transcript.

### Keyboard Shortcuts

Navigate quickly with keyboard shortcuts:

- **Cmd+K** -- Open the command palette
- **Cmd+1** through **Cmd+9** -- Jump directly to a terminal by position
- **Cmd+Shift** -- Switch back to your last active terminal

All shortcuts are customizable through the settings.

### Workspace Setup

When creating a terminal, you can have it automatically clone a git repository and run setup scripts. This is useful for spinning up new project workspaces quickly. There's also support for custom teardown scripts when deleting a workspace.

### Process and Port Monitoring

Each terminal shows what command is currently running and which network ports are being listened on. This makes it easy to see at a glance which services are up and which terminals are busy.

### Git Integration

The dashboard automatically detects the current git branch in each terminal and shows a summary of uncommitted changes (lines added and removed). Branch names are displayed in the sidebar next to each terminal for quick reference.

### Notifications

Get browser notifications when Claude needs your permission to proceed or when a session finishes its work. Notifications are clickable and take you directly to the relevant session. There are also audio cues so you can hear when something needs your attention even if the dashboard isn't in focus.

### Settings

Customize the dashboard to your liking:

- **Default shell** -- Choose which shell new terminals use
- **Font size** -- Adjust the terminal text size
- **Message display** -- Toggle visibility of Claude's thinking, tool calls, and tool output
- **Line clamp** -- Limit how many lines of each message are shown before needing to expand
- **Keybindings** -- Remap any keyboard shortcut

### Resizable Layout

The sidebar and main panel can be resized by dragging the divider between them. Your layout preference is saved and restored between sessions.
