# GitHub Webhooks Investigation

Investigation for adding real-time PR notifications via GitHub webhooks.

## Goal

Use webhooks as triggers to force-fetch GitHub PR data (existing `refreshPRChecks` flow), rather than parsing webhook payloads directly. This keeps implementation simple - webhooks just signal "something changed".

## Events We Care About

| Need | Webhook Event | Notes |
|------|---------------|-------|
| PR Review | `pull_request_review` | `action`: submitted, edited, dismissed |
| PR Comment | `issue_comment` | General PR comments (not inline) |
| PR Comment (inline) | `pull_request_review_comment` | Code review comments |
| Checks Passed/Failed | `check_suite` | Only `action: "completed"` |
| PR Merged | `pull_request` | `action: "closed"` + `merged: true` |

**Dropped**: `check_run` - too noisy, `check_suite` is sufficient.

## Webhook Payload Notes

All payloads include:
- `repository.full_name` - e.g. "owner/repo"
- `sender` - user who triggered
- `action` - what happened

We only need `repository.full_name` to know which repo to refresh.

---

## Architecture: ngrok + Auto-managed Webhooks

Since the app runs locally, we use ngrok to create a public tunnel. Webhooks are automatically created/updated via GitHub API.

### Flow

```
GitHub webhook → ngrok public URL → localhost:{SERVER_PORT}/api/webhooks/github → debounce → refreshPRChecksForRepos()
```

ngrok creates a public URL (e.g., `https://abc123.ngrok.io`) that forwards all traffic to `localhost:{port}`. The webhook URL registered with GitHub is `{ngrokUrl}/api/webhooks/github`.

### Why ngrok over smee.io

- **Privacy**: Data goes direct to localhost, no third-party dashboard can see payloads
- **No external dependency**: smee.io is a hosted service; ngrok runs locally
- **Auto-management**: We create/update webhooks programmatically

---

## Environment Variables

```bash
# server/env.ts
NGROK_AUTHTOKEN    # Optional - enables authenticated ngrok (better rate limits)
NGROK_DOMAIN       # Optional - static domain (requires NGROK_AUTHTOKEN)
```

**Validation:**
- `NGROK_DOMAIN` without `NGROK_AUTHTOKEN` → Error
- No ngrok env but stored webhooks exist → Disable webhooks, warn

**Note:** Webhook secret is auto-generated and stored in DB, no env var needed.

---

## Settings Storage

Store webhook state in existing `settings` table (JSON config):

```typescript
// src/types.ts - add to Settings interface
interface Settings {
  // ... existing fields ...
  webhook_secret?: string  // Auto-generated, used for all webhooks
  ngrok_url?: string       // Last ngrok URL webhooks were configured with
  repo_webhooks?: Record<string, {
    id: number
    missing?: boolean  // true if webhook no longer exists in GitHub
  }>
  hide_gh_authors?: { repo: string; author: string }[]  // repo: '*' for global
}
```

`ngrok_url` is stored to compare on restart - if ngrok URL changed, update webhooks in GitHub.

---

## Implementation

### 1. Shared State (server/github/checks.ts)

```typescript
// Per-repo cache with TTL
const checksCache = new Map<string, { prs: PRCheckStatus[]; fetchedAt: number }>()

// Last emitted PRs (all repos combined) - for client state
let lastEmittedPRs: PRCheckStatus[] = []

// For notification comparison (keyed by "repo#prNumber")
let lastPRData = new Map<string, PRCheckStatus>()

// Skip notifications on first load
let initialFullFetchDone = false
```

### 2. Unified Refresh Function (server/github/checks.ts)

Single function for all refetch scenarios:

```typescript
interface RefreshOptions {
  repos?: string[]           // Specific repos (webhook-triggered)
  repoData?: RepoData[]      // From branch detection (polling)
  force?: boolean            // Bypass cache
}

async function refreshPRs(options: RefreshOptions = {}): Promise<void> {
  const { repos: targetRepos, repoData, force = false } = options

  // Determine what to fetch
  let reposToFetch: RepoData[]

  if (targetRepos) {
    // Webhook: invalidate cache for target repos
    for (const repo of targetRepos) {
      checksCache.delete(repo)
    }
    reposToFetch = targetRepos.map(r => {
      const [owner, repo] = r.split('/')
      return { owner, repo, branches: new Set<string>() }
    })
  } else if (repoData) {
    // Polling: use provided repo data with branches
    reposToFetch = repoData
  } else {
    // Manual: collect fresh
    reposToFetch = await collectMonitoredRepos()
  }

  // Fetch PRs
  const newPRs: PRCheckStatus[] = []
  for (const { owner, repo, branches } of reposToFetch) {
    const repoKey = `${owner}/${repo}`
    if (force) checksCache.delete(repoKey)

    const openPRs = await fetchOpenPRs(owner, repo)
    newPRs.push(...openPRs)

    // Handle merged PRs for branches that no longer have open PRs
    const openBranches = new Set(openPRs.map(pr => pr.branch))
    const closedBranches = [...branches].filter(b => !openBranches.has(b))
    if (closedBranches.length > 0) {
      const mergedPRs = await fetchMergedPRsForBranches(owner, repo, closedBranches)
      newPRs.push(...mergedPRs)
    }
  }

  // Merge with existing PRs if partial refresh (webhook)
  let allPRs: PRCheckStatus[]
  if (targetRepos) {
    const otherPRs = lastEmittedPRs.filter(pr => !targetRepos.includes(pr.repo))
    allPRs = [...otherPRs, ...newPRs]
  } else {
    allPRs = newPRs
  }

  // Process changes & create notifications
  await processNewPRData(newPRs)

  // Update shared state & emit
  lastEmittedPRs = allPRs
  getIO()?.emit('github:pr-checks', { prs: allPRs, username: ghUsername })
}
```

### 3. Polling (every 60s)

```typescript
async function pollAllPRChecks(): Promise<void> {
  // Collect monitored terminals & detect repos/branches
  const repoData = await collectMonitoredRepos()

  // Call unified refresh
  await refreshPRs({ repoData })
}
```

### 4. Webhook Queue (throttle, fires every 2s)

```typescript
const WEBHOOK_INTERVAL_MS = 2000

interface WebhookQueue {
  pendingRepos: Set<string>
  timer: NodeJS.Timeout | null
}

const webhookQueue: WebhookQueue = {
  pendingRepos: new Set(),
  timer: null,
}

function flushWebhookBatch() {
  const repos = [...webhookQueue.pendingRepos]
  webhookQueue.pendingRepos.clear()
  webhookQueue.timer = null

  if (repos.length === 0) return
  if (!initialFullFetchDone) return

  log.info({ repos }, 'Webhook triggered PR refresh')
  refreshPRs({ repos })
}

export function queueWebhookRefresh(repo: string) {
  if (!initialFullFetchDone) return

  webhookQueue.pendingRepos.add(repo)

  // Start timer if not already running (throttle, not debounce)
  if (!webhookQueue.timer) {
    webhookQueue.timer = setTimeout(flushWebhookBatch, WEBHOOK_INTERVAL_MS)
  }
}
```

### 5. Webhook Route (server/index.ts)

```typescript
import crypto from 'node:crypto'
import { queueWebhookRefresh } from './github/checks'
import { getSettings } from './db'

fastify.post('/api/webhooks/github', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string
  const event = request.headers['x-github-event'] as string
  const payload = request.body as Record<string, unknown>

  // Verify HMAC signature using stored secret
  const settings = await getSettings()
  if (settings.webhook_secret) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', settings.webhook_secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    if (signature !== expected) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }
  }

  const repo = (payload.repository as { full_name?: string })?.full_name
  if (!repo) return reply.send({ ok: true, queued: false })

  // Only queue for relevant events
  const relevantEvents = [
    'pull_request',
    'pull_request_review',
    'pull_request_review_comment',
    'issue_comment',
    'check_suite',
  ]

  if (!relevantEvents.includes(event)) {
    return reply.send({ ok: true, queued: false })
  }

  // For check_suite, only care about completed
  if (event === 'check_suite' && payload.action !== 'completed') {
    return reply.send({ ok: true, queued: false })
  }

  queueWebhookRefresh(repo)
  return reply.send({ ok: true, queued: true })
})
```

### 6. ngrok Initialization (server/github/webhooks.ts)

```typescript
import ngrok from '@ngrok/ngrok'
import { getSettings, updateSettings } from '../db'
import { log } from '../logger'
import { env } from '../env'

let ngrokListener: ngrok.Listener | null = null

export async function initNgrok(port: number): Promise<void> {
  const token = env.NGROK_AUTHTOKEN
  const domain = env.NGROK_DOMAIN

  // Domain requires token
  if (domain && !token) {
    throw new Error('NGROK_DOMAIN requires NGROK_AUTHTOKEN')
  }

  // Start ngrok (works without token, just with limitations)
  ngrokListener = await ngrok.forward({
    addr: port,
    authtoken: token,  // undefined is fine
    domain: domain,
  })

  const ngrokUrl = ngrokListener.url()!
  log.info({ url: ngrokUrl, static: !!domain }, 'ngrok tunnel started')

  // Check if URL changed - update webhooks if so
  const settings = await getSettings()
  const storedUrl = settings.ngrok_url
  const repoWebhooks = settings.repo_webhooks ?? {}

  if (ngrokUrl !== storedUrl && Object.keys(repoWebhooks).length > 0) {
    log.info({ oldUrl: storedUrl, newUrl: ngrokUrl }, 'ngrok URL changed, updating webhooks')

    for (const [repo, webhook] of Object.entries(repoWebhooks)) {
      if (webhook.missing) continue  // Skip missing webhooks

      try {
        await updateWebhookUrl(repo, webhook.id, ngrokUrl)
        log.info({ repo }, 'Updated webhook URL')
      } catch (err) {
        log.error({ repo, err }, 'Failed to update webhook URL')
      }
    }

    await updateSettings({ ngrok_url: ngrokUrl })
  } else if (ngrokUrl !== storedUrl) {
    // No webhooks, just store the URL
    await updateSettings({ ngrok_url: ngrokUrl })
  }
}


// Background polling - validate webhooks every 5 minutes
const WEBHOOK_VALIDATION_INTERVAL = 5 * 60 * 1000  // 5 minutes

export function startWebhookValidationPolling(): void {
  // Run immediately, then every 5 min
  validateStoredWebhooks()
  setInterval(validateStoredWebhooks, WEBHOOK_VALIDATION_INTERVAL)
}

async function validateStoredWebhooks(): Promise<void> {
  const settings = await getSettings()
  const repoWebhooks = settings.repo_webhooks ?? {}

  if (Object.keys(repoWebhooks).length === 0) return

  const updatedWebhooks = { ...repoWebhooks }
  let hasChanges = false

  for (const [repo, webhook] of Object.entries(repoWebhooks)) {
    const exists = await checkWebhookExists(repo, webhook.id)

    if (!exists && !webhook.missing) {
      updatedWebhooks[repo] = { ...webhook, missing: true }
      hasChanges = true
      log.warn({ repo, hookId: webhook.id }, 'Webhook not found in GitHub, marked as missing')
    } else if (exists && webhook.missing) {
      // Webhook exists again (recreated externally?) - clear missing flag
      updatedWebhooks[repo] = { id: webhook.id }
      hasChanges = true
      log.info({ repo }, 'Webhook found again, cleared missing flag')
    }
  }

  if (hasChanges) {
    await updateSettings({ repo_webhooks: updatedWebhooks })
  }
}
```

**Client - refetch settings every 5 min:**
```typescript
// Using SWR
const { data: settings } = useSWR('/api/settings', fetcher, {
  refreshInterval: 5 * 60 * 1000  // 5 minutes
})

// Or React Query
const { data: settings } = useQuery({
  queryKey: ['settings'],
  queryFn: fetchSettings,
  refetchInterval: 5 * 60 * 1000
})
```

### 7. Webhook CRUD Operations

```typescript
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
]

// Generate webhook secret once, reuse for all webhooks
async function getOrCreateWebhookSecret(): Promise<string> {
  const settings = await getSettings()

  if (settings.webhook_secret) {
    return settings.webhook_secret
  }

  // Generate 32-byte random secret
  const secret = crypto.randomBytes(32).toString('hex')
  await updateSettings({ webhook_secret: secret })

  return secret
}

async function checkWebhookExists(repo: string, hookId: number): Promise<boolean> {
  try {
    const [owner, repoName] = repo.split('/')
    await execFileAsync('gh', ['api', `repos/${owner}/${repoName}/hooks/${hookId}`])
    return true
  } catch {
    return false
  }
}

async function updateWebhookUrl(repo: string, hookId: number, ngrokUrl: string): Promise<void> {
  const [owner, repoName] = repo.split('/')
  const webhookUrl = `${ngrokUrl}/api/webhooks/github`

  await execFileAsync('gh', [
    'api', `repos/${owner}/${repoName}/hooks/${hookId}`,
    '-X', 'PATCH',
    '-f', `config[url]=${webhookUrl}`,
    '-f', 'config[content_type]=json',
  ])
}

export async function createRepoWebhook(repo: string): Promise<void> {
  const settings = await getSettings()

  if (!settings.ngrok_url) {
    throw new Error('ngrok not running - set NGROK_AUTHTOKEN and restart server')
  }

  const secret = await getOrCreateWebhookSecret()
  const [owner, repoName] = repo.split('/')
  const webhookUrl = `${ngrokUrl}/api/webhooks/github`

  // Build events args
  const eventsArgs = WEBHOOK_EVENTS.flatMap(e => ['-f', `events[]=${e}`])

  const { stdout } = await execFileAsync('gh', [
    'api', `repos/${owner}/${repoName}/hooks`,
    '-X', 'POST',
    '-f', 'name=web',
    '-f', `config[url]=${webhookUrl}`,
    '-f', 'config[content_type]=json',
    '-f', `config[secret]=${secret}`,
    ...eventsArgs,
  ])

  const hook = JSON.parse(stdout)

  await updateSettings({
    repo_webhooks: {
      ...settings.repo_webhooks,
      [repo]: { id: hook.id },
    },
  })

  log.info({ repo, hookId: hook.id }, 'Created webhook')
}

export async function deleteRepoWebhook(repo: string): Promise<void> {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]

  if (!webhook) return

  const [owner, repoName] = repo.split('/')

  try {
    await execFileAsync('gh', [
      'api', `repos/${owner}/${repoName}/hooks/${webhook.id}`,
      '-X', 'DELETE',
    ])
  } catch {
    // Webhook may already be deleted - that's fine
  }

  const { [repo]: _, ...rest } = settings.repo_webhooks ?? {}
  await updateSettings({ repo_webhooks: rest })

  log.info({ repo }, 'Deleted webhook')
}

export async function recreateRepoWebhook(repo: string): Promise<void> {
  await deleteRepoWebhook(repo)
  await createRepoWebhook(repo)
}
```

---

## Startup Behavior

**ngrok init:**
- `NGROK_AUTHTOKEN` set → start ngrok
- `NGROK_AUTHTOKEN` not set → skip (lazy-start when creating webhook)
- `NGROK_DOMAIN` without `NGROK_AUTHTOKEN` → error

**Webhook validation polling:**
- Runs every 5 minutes in background (non-blocking)
- Checks if stored webhooks exist in GitHub
- Marks missing or clears missing flag
- Client refetches settings every 5 min to pick up changes

---

## Throttle Behavior (Webhook Queue)

Fire every 2s if there's anything in the queue:

| Scenario | Result |
|----------|--------|
| 1 webhook, then quiet | Fires at t=2s |
| Webhooks at t=0, t=1s, t=1.5s | Fires at t=2s (with all 3 repos) |
| Webhooks every 500ms for 10s | Fires at t=2s, t=4s, t=6s, t=8s, t=10s, t=12s |

See "4. Webhook Queue" in Implementation section for code.

---

## Files to Modify

1. `server/env.ts` - Add `NGROK_AUTHTOKEN`, `NGROK_DOMAIN`
2. `server/github/webhooks.ts` - New file: ngrok init, webhook CRUD, test ping, validation polling
3. `server/github/checks.ts` - Unified `refreshPRs`, webhook queue, `processNewPRData`, hidden author filtering, increase comment limit to 50
4. `server/index.ts` - Add `/api/webhooks/github` route, webhook management routes, call `initNgrok()` on startup, remove `/api/.../comments` endpoint
5. `server/db.ts` - Add notification CRUD functions
6. `schema.sql` - Add `notifications` table
7. `src/types.ts` - Add `ngrok_url`, `webhook_secret`, `repo_webhooks`, `hide_gh_authors` to Settings
8. `src/context/TerminalContext.tsx` - Remove client-side PR comparison logic
9. `src/components/WebhooksModal.tsx` - New file: webhook management UI
10. `src/components/SettingsModal.tsx` - Add "GitHub Webhooks" button, red badge logic
11. Client components - Change "load more" from API call to revealing more items
12. `package.json` - Add `@ngrok/ngrok` dependency

---

## User-Facing Features

### Webhooks Settings Modal

Accessed via Settings → GitHub Webhooks button. Opens modal to manage webhooks per repo.

**Warning Indicators:**

Red badge on settings icon + red "GitHub Webhooks" button when:
1. Any webhooks are marked as missing
2. Webhooks exist (not missing) but `ngrok_url` is null (ngrok not running)

```typescript
const repoWebhooks = settings.repo_webhooks ?? {}
const webhooks = Object.values(repoWebhooks)

const missingCount = webhooks.filter(w => w.missing).length
const activeCount = webhooks.filter(w => !w.missing).length
const ngrokRunning = !!settings.ngrok_url

// Show red badge/button if:
const hasWarning = missingCount > 0 || (activeCount > 0 && !ngrokRunning)
```

**UI Structure:**

When ngrok is running:
```
┌─────────────────────────────────────────────────┐
│ GitHub Webhooks                              ✕  │
├─────────────────────────────────────────────────┤
│ ⚠️ 1 webhook missing - recreate or delete       │  ← warning if missing
│ ─────────────────────────────────────────────── │
│ ngrok: https://abc123.ngrok.io  [Copy]          │
│ ─────────────────────────────────────────────── │
│                                                 │
│ owner/repo-1                                    │
│   ✓ Webhook active     [Test] [Delete]          │
│                                                 │
│ owner/repo-2                                    │
│   ⚠ Webhook missing    [Recreate] [Delete]      │
│                                                 │
│ owner/repo-3                                    │
│   No webhook           [Create]                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

When ngrok NOT running:
```
┌─────────────────────────────────────────────────┐
│ GitHub Webhooks                              ✕  │
├─────────────────────────────────────────────────┤
│ ⚠️ ngrok not running - webhooks inactive        │
│                                                 │
│ ─────────────────────────────────────────────── │
│                                                 │
│ owner/repo-1                                    │
│   ○ Inactive           [Create]                 │
│                                                 │
│ owner/repo-2                                    │
│   ○ Inactive           [Test](disabled) [Delete]│
│                                                 │
└─────────────────────────────────────────────────┘
```

**Client computes missing count from settings:**
```typescript
const missingCount = Object.values(settings.repo_webhooks ?? {})
  .filter(w => w.missing).length

// Show red badge on settings icon if missingCount > 0
```

### API Endpoints

**GET /api/settings** - Already returns settings including `ngrok_url` and `repo_webhooks`.

Client derives webhook status:

```typescript
// Client side
const { settings } = useSettings()
const terminals = useTerminals()

// Repos from terminals
const repos = [...new Set(terminals.map(t => t.git_repo?.repo).filter(Boolean))]

// Match with webhook data from settings
const webhookStatus = repos.map(repo => ({
  repo,
  webhook: settings.repo_webhooks?.[repo] ?? null
}))

const missingCount = Object.values(settings.repo_webhooks ?? {})
  .filter(w => w.missing).length
```

**POST /api/github/webhooks/:repo** - Create webhook

**DELETE /api/github/webhooks/:repo** - Delete webhook

**POST /api/github/webhooks/:repo/test** - Test webhook (ping)

### ngrok Status

`settings.ngrok_url` is the source of truth for whether ngrok is running.

**When ngrok is running:**
- `ngrok_url` is set in settings
- All webhook controls enabled
- Webhooks receive events

**When ngrok is NOT running:**
- `ngrok_url` is null in settings
- Warning shown: "ngrok not running - webhooks inactive"
- All webhooks shown as "Inactive"
- Create/Delete still enabled (webhooks can be managed in GitHub)
- Test button disabled (can't test without ngrok)

ngrok works with or without `NGROK_AUTHTOKEN` (token just gives better rate limits and optional static domain).

### Test Webhook (Ping)

GitHub supports pinging webhooks to test they work:

```typescript
export async function testWebhook(repo: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]

  if (!webhook || webhook.missing) {
    return { ok: false, error: 'Webhook not found' }
  }

  try {
    const [owner, repoName] = repo.split('/')
    await execFileAsync('gh', [
      'api', `repos/${owner}/${repoName}/hooks/${webhook.id}/pings`,
      '-X', 'POST'
    ])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

Server receives `ping` event → can show "✓ Webhook working" in UI.

### Delete Webhook

```typescript
export async function deleteRepoWebhook(repo: string): Promise<void> {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]
  if (!webhook) return

  // Only call GitHub API if not marked as missing
  if (!webhook.missing) {
    try {
      const [owner, repoName] = repo.split('/')
      await execFileAsync('gh', [
        'api', `repos/${owner}/${repoName}/hooks/${webhook.id}`,
        '-X', 'DELETE'
      ])
    } catch {
      // Already deleted or no access - fine
    }
  }

  // Always remove from DB
  const { [repo]: _, ...rest } = settings.repo_webhooks ?? {}
  await updateSettings({ repo_webhooks: rest })
}
```

### Recreate Webhook

For missing webhooks:

```typescript
export async function recreateRepoWebhook(repo: string): Promise<void> {
  // Delete from DB (skip GitHub call since it's missing)
  await deleteRepoWebhook(repo)
  // Create fresh
  await createRepoWebhook(repo)
}
```

---

## Setup Instructions

1. **Install ngrok package:**
   ```bash
   npm install @ngrok/ngrok
   ```

2. **Get ngrok auth token** (optional but recommended):
   - Sign up at https://ngrok.com
   - Get token from https://dashboard.ngrok.com/get-started/your-authtoken
   - Add to `.env`: `NGROK_AUTHTOKEN=your_token`

3. **Get static domain** (optional, requires paid plan):
   - In ngrok dashboard, create a domain
   - Add to `.env`: `NGROK_DOMAIN=yourapp.ngrok.io`

4. **Start server:**
   - Server will start ngrok tunnel automatically
   - Log will show the public URL

5. **Enable webhooks per repo:**
   - Use UI to enable webhooks for repos you want real-time updates on
   - Webhooks are created automatically via GitHub API

---

---

## Server-Side Notifications

Move notification detection from client to server. Store in DB for persistence.

### Notifications Table

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,

  -- Dedupe: SHA256 hash (64 hex chars)
  dedup_hash VARCHAR(64) UNIQUE,

  -- Queryable columns only
  type VARCHAR(50) NOT NULL,  -- 'merged', 'check_failed', 'approved', 'changes_requested', 'comment', 'review'
  repo TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Everything else in JSON
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_repo ON notifications(repo);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
```

### Notification Data Structure

```typescript
interface NotificationData {
  pr_number: number
  pr_title: string
  pr_url: string
  branch: string
  actor?: string         // who triggered (commenter, reviewer)
  actor_avatar?: string
  body?: string          // comment/review body preview (truncated)
  url?: string           // direct link to comment/review
  check_name?: string    // for check_failed
}
```

### Dedupe Hash Generation

Prevent duplicate notifications using SHA256 hash of unique key:

```typescript
import crypto from 'node:crypto'

function generateDedupHash(type: string, repo: string, prNumber: number, extra: string = ''): string {
  const key = `${type}:${repo}#${prNumber}:${extra}`
  return crypto.createHash('sha256').update(key).digest('hex')
}
```

| Type | Extra (dedupe key suffix) |
|------|---------------------------|
| merged | `''` (one per PR) |
| check_failed | `{check_name}` |
| approved | `{author}` |
| changes_requested | `{author}` |
| comment | `{author}:{createdAt}` |
| review | `{author}:{review_id}` |

### Insert with Dedupe

```typescript
async function insertNotification(
  type: string,
  repo: string,
  prNumber: number,
  data: NotificationData,
  dedupExtra: string = ''
): Promise<boolean> {
  const dedupHash = generateDedupHash(type, repo, prNumber, dedupExtra)

  const result = await pool.query(`
    INSERT INTO notifications (dedup_hash, type, repo, data)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (dedup_hash) DO NOTHING
    RETURNING id
  `, [dedupHash, type, repo, JSON.stringify(data)])

  return result.rowCount > 0  // true if inserted, false if duplicate
}
```

### Server-Side Change Detection

```typescript
let initialFullFetchDone = false
let lastPRData = new Map<string, PRCheckStatus>()  // keyed by "repo#prNumber"

async function processNewPRData(newPRs: PRCheckStatus[]): Promise<void> {
  const settings = await getSettings()
  const hiddenAuthors = settings.hide_gh_authors ?? []

  if (!initialFullFetchDone) {
    // First fetch - just store, don't generate notifications
    for (const pr of newPRs) {
      lastPRData.set(`${pr.repo}#${pr.prNumber}`, pr)
    }
    initialFullFetchDone = true
    return
  }

  const newNotifications: Notification[] = []

  for (const pr of newPRs) {
    const key = `${pr.repo}#${pr.prNumber}`
    const prev = lastPRData.get(key)

    if (prev) {
      // PR merged
      if (prev.state !== 'MERGED' && pr.state === 'MERGED') {
        const inserted = await insertNotification('merged', pr.repo, pr.prNumber, {
          pr_number: pr.prNumber, pr_title: pr.prTitle, pr_url: pr.prUrl, branch: pr.branch
        })
        if (inserted) newNotifications.push(/* ... */)
      }

      // Check failed
      if (!hasFailedChecks(prev) && hasFailedChecks(pr)) {
        const failedCheck = pr.checks.find(c => c.conclusion === 'FAILURE')
        await insertNotification('check_failed', pr.repo, pr.prNumber, {
          pr_number: pr.prNumber, pr_title: pr.prTitle, pr_url: pr.prUrl, branch: pr.branch,
          check_name: failedCheck?.name
        }, failedCheck?.name ?? '')
      }

      // Approved / Changes requested
      if (prev.reviewDecision !== 'APPROVED' && pr.reviewDecision === 'APPROVED') {
        await insertNotification('approved', pr.repo, pr.prNumber, { /* ... */ })
      }
      if (prev.reviewDecision !== 'CHANGES_REQUESTED' && pr.reviewDecision === 'CHANGES_REQUESTED') {
        await insertNotification('changes_requested', pr.repo, pr.prNumber, { /* ... */ })
      }

      // New comments (skip hidden authors)
      const prevCommentKeys = new Set(prev.comments.map(c => `${c.author}:${c.createdAt}`))
      for (const comment of pr.comments) {
        if (isHiddenAuthor(hiddenAuthors, pr.repo, comment.author)) continue
        const commentKey = `${comment.author}:${comment.createdAt}`
        if (!prevCommentKeys.has(commentKey)) {
          await insertNotification('comment', pr.repo, pr.prNumber, {
            pr_number: pr.prNumber, pr_title: pr.prTitle, pr_url: pr.prUrl, branch: pr.branch,
            actor: comment.author, body: comment.body.slice(0, 200), url: comment.url
          }, commentKey)
        }
      }

      // New reviews (skip hidden authors)
      const prevReviewKeys = new Set(prev.reviews.map(r => `${r.author}:${r.id}`))
      for (const review of pr.reviews) {
        if (isHiddenAuthor(hiddenAuthors, pr.repo, review.author)) continue
        const reviewKey = `${review.author}:${review.id}`
        if (!prevReviewKeys.has(reviewKey)) {
          await insertNotification('review', pr.repo, pr.prNumber, {
            pr_number: pr.prNumber, pr_title: pr.prTitle, pr_url: pr.prUrl, branch: pr.branch,
            actor: review.author, body: review.body?.slice(0, 200)
          }, reviewKey)
        }
      }
    }

    // Update stored data
    lastPRData.set(key, pr)
  }

  // Emit new notifications to clients
  if (newNotifications.length > 0) {
    getIO()?.emit('notifications:new', newNotifications)
  }
}
```

---

## Hidden Authors

Store hidden authors in settings (server-side filtering, not client-side).

### Settings Addition

```typescript
interface Settings {
  // ... existing ...
  hide_gh_authors?: { repo: string; author: string }[]  // repo: '*' for global
}
```

### Filtering in PR Fetch

GitHub API doesn't support filtering by author - must filter response.

```typescript
function isHiddenAuthor(
  hiddenAuthors: { repo: string; author: string }[],
  repo: string,
  author: string
): boolean {
  return hiddenAuthors.some(
    h => (h.repo === repo || h.repo === '*') && h.author === author
  )
}

// In fetchOpenPRs
const settings = await getSettings()
const hiddenAuthors = settings.hide_gh_authors ?? []

// After fetching comments, filter them
const filteredComments = comments.filter(
  c => !isHiddenAuthor(hiddenAuthors, `${owner}/${repo}`, c.author)
)
```

### No Pagination - Fetch All Upfront

Simplify by returning all comments/reviews in `fetchOpenPRs`. Client "load more" just reveals more from the array (no API call).

```typescript
// In fetchOpenPRs - return more comments (was 5, now 50)
const filteredComments = allComments
  .filter(c => !isHiddenAuthor(hiddenAuthors, `${owner}/${repo}`, c.author))
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, 50)  // Cap at 50 per PR

return { ...pr, comments: filteredComments }
```

**Remove:**
- `/api/github/:owner/:repo/pr/:pr/comments` endpoint
- `fetchPRComments` function

**Client "load more":**
```typescript
const [visibleCount, setVisibleCount] = useState(5)
const visibleComments = pr.comments.slice(0, visibleCount)

<button onClick={() => setVisibleCount(v => v + 10)}>
  Show more ({pr.comments.length - visibleCount} remaining)
</button>
```

---

## Per-Repo Refetch

When webhooks trigger a refetch, only fetch the affected repos.

```typescript
export async function refreshPRChecksForRepos(repos: string[]): Promise<void> {
  if (ghAvailable === null) {
    ghAvailable = await checkGhAvailable()
  }
  if (!ghAvailable) return

  const results: PRCheckStatus[] = []

  for (const repo of repos) {
    checksCache.delete(repo)  // Invalidate cache

    const [owner, repoName] = repo.split('/')

    // Get previously known PRs for this repo
    const previousPRs = lastEmittedPRs.filter(pr => pr.repo === repo)
    const previousBranches = new Set(previousPRs.map(pr => pr.branch))

    // Fetch current open PRs
    const openPRs = await fetchOpenPRs(owner, repoName, true)
    results.push(...openPRs)

    // Find branches that had open PRs but now don't (could be merged)
    const currentBranches = new Set(openPRs.map(pr => pr.branch))
    const closedBranches = [...previousBranches].filter(b => !currentBranches.has(b))

    // Fetch merged PRs for those branches
    if (closedBranches.length > 0) {
      const mergedPRs = await fetchMergedPRsForBranches(owner, repoName, closedBranches)
      results.push(...mergedPRs)
    }
  }

  // Merge with PRs from other repos (not refreshed)
  const otherPRs = lastEmittedPRs.filter(pr => !repos.includes(pr.repo))
  const allPRs = [...otherPRs, ...results]

  // Process for notifications
  await processNewPRData(results)

  lastEmittedPRs = allPRs
  getIO()?.emit('github:pr-checks', { prs: allPRs, username: ghUsername })
}
```

---

## Client Changes

Remove PR comparison logic from `TerminalContext.tsx`:
- Delete `previousPRsRef` and comparison logic
- Listen to `notifications:new` event for browser notifications
- Can add notification center UI later

---

## Security Notes

- Webhook payloads go directly to your machine via ngrok (no third-party can see them)
- Webhook secret is auto-generated (32 bytes / 64 hex chars) and stored in local DB
- All webhooks use the same secret for HMAC signature verification
- ngrok URL is random/obscure unless using static domain
- Webhook IDs and secret are stored locally, not exposed
- Notifications deduped via SHA256 hash - prevents duplicates on restart/crash
