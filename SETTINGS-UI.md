# Settings UI Design

A VS Code-style settings page with a left sidebar for category navigation, a search bar at the top, and a scrollable right pane displaying settings grouped under breadcrumb-style headers (`Category > Subcategory > Setting Name`).

---

## Architecture

### Current State
Settings are scattered across 6+ separate modals: `SettingsModal`, `KeymapModal`, `RemoteAccessModal`, `GitHubModal`, `MobileKeyboardCustomize`, `PushNotificationModal`, plus status bar drag-and-drop config. Many server constants that would be useful to expose are hardcoded.

### Target State
A single full-page (or full-modal) settings view with:
- **Search bar** at top (filters settings by name, description, category, keywords)
- **Category tree** on the left sidebar
- **Settings list** on the right, rendered as flat scrollable sections with breadcrumb headers and ability to click them to navigate
- Each setting has: breadcrumb path, bold name, description, and an appropriate input control
- special case is the keymap section - where its UI is a separate full height/width view
- **Go to setting** - ability to fire a custom event from anywhere in the app to open settings and scroll to any section

### UI/UX Specifics

- we can fully scroll the sidebar
- on the right side we fully render all settings as a scrollable view where we can scroll to anything if needed
- keymap is a special case where when clicked/activated by event - we open its own full view on the right side. If we are in the full settings scrollable view - we render a button to open that full keymap view

### Setting Controls
| Control Type | Used For |
|---|---|
| Text input | Strings (shell path, ngrok domain) |
| Number input | Numeric values with min/max (font size, timeouts, limits) |
| Checkbox/Toggle | Booleans (show_thinking, cursorBlink) |
| Dropdown/Select | Enums (preferred_ide) |
| Shortcut recorder | Keyboard shortcuts |
| Ordered list (drag) | Status bar sections, mobile keyboard rows |
| Tag list | Author filters (hide/silence/collapse) |
| PR list | Hidden PRs |

---

## Categories & Settings

### 1. General

#### General: Application
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Preferred IDE | `preferred_ide` | enum: `cursor`, `vscode` | `cursor` | Which IDE to launch when opening files |

#### General: Notifications
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Push Notification Subscriptions | `push_subscriptions` | managed list | `[]` | Registered push notification endpoints |
| Desktop Active Timeout | `notification_active_timeout` | number (ms) | `60000` | How long after last activity to suppress push notifications |

#### General: Security
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Max Login Failures | `auth_max_failures` | number | `5` | Failed login attempts before lockout |
| Lockout Duration | `auth_lockout_ms` | number (ms) | `600000` | How long an IP stays locked out (10 min) |

Also a section for basic auth - just explaining to how to change the ENV

---

### 2. Terminal

#### Terminal: Shell
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Default Shell | `default_shell` | filepath | `/bin/bash` | Shell used when creating new terminals |
| Shell Templates | `shell_templates` | ordered list | `[]` | Reusable shell command templates |

#### Terminal: Display
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Font Size | `font_size` | number (8-32) | `13` | Terminal font size (desktop) |
| Mobile Font Size | `mobile_font_size` | number (8-32) | `10` | Terminal font size (mobile) |

#### Terminal: Scrollback
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Scrollback Lines (Client) | `scrollback` | number | `10000` | Lines retained in the terminal view (xterm.js) |
| Scrollback Lines (Server) | `max_buffer_lines` | number | `5000` | Lines retained in the server-side output buffer |

#### Terminal: Session
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Idle Timeout | `session_timeout_ms` | number (ms) | `1800000` | Destroy terminal session after this idle period (30 min) |

#### Terminal: Mobile Keyboard
Display the current MobileKeyboardCustomize inline, from there we can open the current other modals and use the same flow
---

### 3. Claude

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Show Thinking | `show_thinking` | boolean | `false` | Display Claude's extended thinking output |
| Show Tool Calls | `show_tools` | boolean | `true` | Display tool call blocks in conversations |
| Show Tool Output | `show_tool_output` | boolean | `false` | Display tool call results (only when Show Tool Calls is on) |
| Ignore External Sessions | `ignore_external_sessions` | boolean | `false` | Skip sessions launched outside WorkIO |
| Message Line Clamp | `message_line_clamp` | number (1-20) | `5` | Max preview lines shown for messages in session list |
| Messages Page Size | `session_messages_page_size` | number | `30` | Messages loaded per page in session view |

Also the Import Sessions UI

---

### 5. Keymap

A dedicated subsection (like VS Code's keybindings editor) with a searchable table of all shortcuts.


#### Navigation
| Setting | Key | Default | Description |
|---|---|---|---|
| Command Palette | `keymap.palette` | `Cmd+K` | Open command palette |
| Go to Tab | `keymap.goToTab` | `Cmd+{digit}` | Switch to terminal tab by number |
| Go to Shell | `keymap.goToShell` | `Alt+{digit}` | Switch to shell by number |
| Previous Shell | `keymap.prevShell` | `Alt+[` | Switch to previous shell |
| Next Shell | `keymap.nextShell` | `Alt+]` | Switch to next shell |
| Toggle Sidebar | `keymap.toggleSidebar` | `` Alt+` `` | Show/hide sidebar |
| Toggle PiP | `keymap.togglePip` | `Cmd+P` | Toggle picture-in-picture window |

#### Shell Management
| Setting | Key | Default | Description |
|---|---|---|---|
| New Shell | `keymap.newShell` | `Alt+N` | Create a new shell |
| Close Shell | `keymap.closeShell` | `Alt+W` | Close the active shell |
| Shell Templates | `keymap.shellTemplates` | `Shift+Alt+K` | Open shell templates menu |

#### Actions
| Setting | Key | Default | Description |
|---|---|---|---|
| Item Actions | `keymap.itemActions` | `Cmd+I` | Open item actions menu |
| Collapse All | `keymap.collapseAll` | `Cmd+Up` | Collapse all sections |
| Settings | `keymap.settings` | `Cmd+,` | Open settings |
| Custom Commands | `keymap.customCommands` | `Alt+A` | Open custom commands |
| Branches | `keymap.branches` | `Ctrl+Shift+Enter` | Open branch selector |
| Pull Branch | `keymap.pullBranch` | `Cmd+T` | Pull current branch |

#### Git
| Setting | Key | Default | Description |
|---|---|---|---|
| Commit | `keymap.commit` | `Cmd+Shift+K` | Commit staged changes |
| Commit (Amend) | `keymap.commitAmend` | `Alt+A` | Amend previous commit |
| Commit (No Verify) | `keymap.commitNoVerify` | `Alt+N` | Commit skipping hooks |

---

### 6. GitHub

#### GitHub: PR Data
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Check Poll Interval | `gh_poll_interval` | number (ms) | `60000` | How often to poll GitHub for PR check status |
| Recent PR Window | `recent_pr_threshold_ms` | number (ms) | `900000` | Time window to mark PRs as "recently created" (15 min) |

#### GitHub: PR Data: Webhooks
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Repo Webhooks | `repo_webhooks` | managed record | `{}` | Webhook registration status per repo (server-managed) |

#### GitHub: PR Data: Query Limits
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Checks | `gh_query_limits.checks` | number | `5` | Max check runs to fetch per PR |
| Reviews | `gh_query_limits.reviews` | number | `10` | Max reviews to fetch per PR |
| Comments | `gh_query_limits.comments` | number | `10` | Max comments to fetch per PR |
| Review Threads | `gh_query_limits.review_threads` | number | `10` | Max review threads to fetch |
| Thread Comments | `gh_query_limits.thread_comments` | number | `10` | Max comments per review thread |
| Review Requests | `gh_query_limits.review_requests` | number | `10` | Max review requests to fetch |
| Reactors | `gh_query_limits.reactors` | number | `3` | Max reactors to show per reaction |

#### GitHub: Author Filters
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Hidden Authors | `hide_gh_authors` | tag list `{repo, author}` | `[]` | Hide all PRs from these authors |
| Silenced Authors | `silence_gh_authors` | tag list `{repo, author}` | `[]` | Suppress notifications but show PRs |
| Collapsed Authors | `collapse_gh_authors` | tag list `{repo, author}` | `[]` | Collapse PRs from these authors by default |
| Hidden PRs | `hidden_prs` | list `{repo, prNumber, title}` | `[]` | Individually hidden PRs |

---

### 7. Remote Access

#### Remote Access: ngrok
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Domain | `ngrok.domain` | string | none | ngrok domain for remote access |
| Auth Token | `ngrok.token` | secret | none | ngrok authentication token |

#### Remote Access: SSH
| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Max SSH Channels | `ssh_max_channels` | number | `10` | Max concurrent SSH exec channels per connection |
| SSH Idle Timeout | `ssh_idle_timeout` | number (ms) | `600000` | Close idle SSH connection after this period (10 min) |
| SSH Command Timeout | `ssh_default_timeout` | number (ms) | `15000` | Default timeout for SSH commands |
| SSH Keepalive Interval | `ssh_keepalive_interval` | number (ms) | `15000` | SSH keepalive ping interval |
| Tunnel Port | `ssh_tunnel_port` | number | `18765` | Local port for reverse SSH tunnel |

---

## Category Tree (Sidebar)

```
Settings
├── General
│   ├── Application
│   ├── Notifications
│   └── Security
├── Terminal
│   ├── Shell
│   ├── Display
│   ├── Scrollback
│   ├── Session
│   └── Mobile Keyboard
├── Claude
├── Keymap
│   ├── Navigation
│   ├── Shell Management
│   ├── Actions
│   └── Git
├── GitHub
│   ├── Polling
│   ├── Query Limits
│   ├── Author Filters
│   └── Webhooks
├── Remote Access
│   ├── ngrok
│   └── SSH
└── Advanced
    ├── Data & Pagination
    └── Performance
```

---

## Implementation Notes

### What's already user-configurable (in DB `settings.config`)
All settings under: General > Application, Terminal > Shell/Display (font only), Editor & AI, Appearance > Status Bar, Keyboard Shortcuts, GitHub > Query Limits/Author Filters, Remote Access > ngrok, Terminal > Mobile Keyboard.

### What needs to become user-configurable (currently hardcoded)
These are server constants or client constants that would need to be added to the settings schema and DB:

**Server constants to expose:**
- `SESSION_TIMEOUT_MS` (Terminal > Session)
- `MAX_BUFFER_LINES` (Terminal > Scrollback)
- `AUTH_MAX_FAILURES`, `AUTH_LOCKOUT_MS` (General > Security)
- `POLL_INTERVAL` (GitHub > Polling)
- `MAX_CHANNELS`, `IDLE_TIMEOUT`, `DEFAULT_TIMEOUT`, `keepaliveInterval` (Remote Access > SSH)
- `ACTIVE_TIMEOUT_MS` (General > Notifications)

**Client constants to expose:**
- `scrollback` in xterm options (Terminal > Scrollback)

### Server Settings Map

Currently server constants like `SESSION_TIMEOUT_MS`, `MAX_BUFFER_LINES`, `POLL_INTERVAL` etc. are scattered across individual module files as top-level `const` declarations. Each module imports its own constant directly. This means changing a value requires restarting the server, and there's no single place to see or manage all server-side configuration.

**Goal:** Replace all scattered `const` declarations with a single in-memory settings map that is loaded from DB on startup and kept in sync on updates. Uses the existing `serverEvents` typed emitter (`server/lib/events.ts`) for change notifications.

#### 1. Add event to ServerEventMap

```typescript
// server/types/events.ts
export interface ServerEventMap {
  // ... existing events ...
  'settings:changed': [changed: Partial<ServerSettings>]
}
```

#### 2. The settings map module

The map is just another `serverEvents` consumer — it listens for `settings:changed` to update itself, same as any other module.

```typescript
// server/settings-map.ts
import serverEvents from '@server/lib/events'

const SERVER_DEFAULTS = {
  session_timeout_ms: 30 * 60 * 1000,
  max_buffer_lines: 5000,
  auth_max_failures: 5,
  auth_lockout_ms: 10 * 60 * 1000,
  gh_poll_interval: 60_000,
  ssh_max_channels: 10,
  ssh_idle_timeout: 10 * 60 * 1000,
  ssh_default_timeout: 15_000,
  ssh_keepalive_interval: 15_000,
  notification_active_timeout: 60_000,
} as const

export type ServerSettings = typeof SERVER_DEFAULTS
type ServerSettingKey = keyof ServerSettings

let settings: Record<string, unknown> = {}

// Called once at server startup, before modules init
export async function loadServerSettings(db: DB) {
  const row = await db.getSettings()
  settings = { ...SERVER_DEFAULTS, ...row.config }
}

// Type-safe getter — modules call this instead of importing their own consts
export function get<K extends ServerSettingKey>(key: K): ServerSettings[K] {
  return (settings[key] ?? SERVER_DEFAULTS[key]) as ServerSettings[K]
}

// Keep in-memory map in sync — just another consumer of the event
serverEvents.on('settings:changed', (changed) => {
  Object.assign(settings, changed)
})
```

#### 3. Settings mutation: write DB + emit event

The mutation is the only place that emits. It writes to DB and fires the event — the map and all other consumers react independently.

```typescript
// server/domains/settings/mutations.ts (existing file)
import serverEvents from '@server/lib/events'

async function updateSettings(db: DB, updates: Partial<Settings>) {
  await db.saveSettings(updates)                    // write to DB
  serverEvents.emit('settings:changed', updates)    // notify all consumers
}
```

#### 4. Consuming modules: read from map, react to changes

Modules replace their hardcoded consts with `get()` calls. For values used in long-lived intervals/timers, they listen to the same event:

```typescript
// Before (scattered const):
// const POLL_INTERVAL = 60_000

// After (from the map):
import { get } from '@server/settings-map'
import serverEvents from '@server/lib/events'

function startPolling() {
  let interval = setInterval(poll, get('gh_poll_interval'))

  serverEvents.on('settings:changed', (changed) => {
    if ('gh_poll_interval' in changed) {
      clearInterval(interval)
      interval = setInterval(poll, get('gh_poll_interval'))
    }
  })
}
```

For values read on every use (like `max_buffer_lines` checked on each write), the `get()` call alone is enough — no listener needed since the map is already kept in sync by its own listener.

#### Summary

| Concern | Mechanism |
|---|---|
| Single source of truth | `settings` map in `server/settings-map.ts` |
| Initial load | `loadServerSettings(db)` at server startup |
| Read a value | `get('key')` — replaces scattered `const` imports |
| Emit changes | `updateSettings()` writes DB then emits `settings:changed` via `serverEvents` |
| Map stays in sync | The map listens to `settings:changed` like any other consumer |
| Modules react | `serverEvents.on('settings:changed', cb)` — restart timers/intervals as needed |
| Defaults | `SERVER_DEFAULTS` — fallback when key missing from DB |

### What should stay hardcoded
- WebSocket URLs, DOM element IDs
- CSS class names, animation durations, touch gesture thresholds
- Internal retry/backoff arrays
- Build/compile configuration
- Pagination for system queries
- SSH tunnel ports (security-sensitive)
- VAPID keys, webhook secrets (server-managed)

### Search Implementation
Each setting should have searchable metadata:
```typescript
{
  key: 'font_size',
  label: 'Font Size',
  description: 'Terminal font size (desktop)',
  category: ['Terminal', 'Display'],
  keywords: ['text', 'size', 'zoom', 'terminal'],
  type: 'number',
  default: 13,
  min: 8,
  max: 32,
}
```

Search matches against: label, description, category path, and keywords.
