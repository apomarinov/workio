import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {
  FailedPRCheck,
  MergedPRSummary,
  PRCheckStatus,
  PRComment,
  PRReview,
} from '../../shared/types'
import type { HiddenGHAuthor } from '../../src/types'
import {
  getAllTerminals,
  getSettings,
  getTerminalById,
  insertNotification,
  updateTerminal,
} from '../db'
import { getIO } from '../io'
import { log } from '../logger'
import { detectGitBranch } from '../pty/manager'
import { execSSHCommand } from '../ssh/exec'

// Cache: cwd -> { owner, repo } or null
const repoCache = new Map<string, { owner: string; repo: string } | null>()

// Cache: "owner/repo" -> { prs, fetchedAt }
const checksCache = new Map<
  string,
  { prs: PRCheckStatus[]; fetchedAt: number }
>()

// Track which terminals we're monitoring: terminalId -> cwd
const monitoredTerminals = new Map<number, string>()

let ghAvailable: boolean | null = null
let ghUsername: string | null = null
let globalChecksPollingId: NodeJS.Timeout | null = null
let lastEmittedPRs: PRCheckStatus[] = []

const POLL_INTERVAL = 60_000 // 60 seconds
const CACHE_TTL = 30_000 // 30
const REFRESH_MIN_INTERVAL = 30_000 // 30 seconds

// Webhook queue for throttling rapid webhook events
const webhookQueue = {
  pendingRepos: new Set<string>(),
  timer: null as NodeJS.Timeout | null,
}
const WEBHOOK_THROTTLE_MS = 2000

// Track last PR data for notification diffing
const lastPRData = new Map<string, PRCheckStatus>()
let initialFullFetchDone = false

/** Decode GitHub GraphQL node ID to extract database ID (last 4 bytes as big-endian uint32) */
function decodeNodeId(nodeId: string): number | null {
  try {
    const base64Part = nodeId.split('_')[1]
    if (!base64Part) return null
    const buffer = Buffer.from(base64Part, 'base64')
    if (buffer.length < 4) return null
    return buffer.readUInt32BE(buffer.length - 4)
  } catch {
    return null
  }
}

export function parseGitHubRemoteUrl(
  url: string,
): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (match) return { owner: match[1], repo: match[2] }
  return null
}

function checkGhAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('gh', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err)
    })
  })
}

function fetchGhUsername(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['api', 'user', '--jq', '.login'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null)
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

async function detectGitHubRepo(
  cwd: string,
  sshHost?: string | null,
): Promise<{ owner: string; repo: string } | null> {
  const cacheKey = sshHost ? `${sshHost}:${cwd}` : cwd

  if (repoCache.has(cacheKey)) {
    return repoCache.get(cacheKey)!
  }

  try {
    let stdout: string

    if (sshHost) {
      const result = await execSSHCommand(
        sshHost,
        'git remote get-url origin',
        cwd,
      )
      stdout = result.stdout
    } else {
      stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          'git',
          ['remote', 'get-url', 'origin'],
          { cwd, timeout: 5000 },
          (err, out) => {
            if (err || !out) return reject(err || new Error('No output'))
            resolve(out)
          },
        )
      })
    }

    const result = parseGitHubRemoteUrl(stdout.trim())
    repoCache.set(cacheKey, result)
    return result
  } catch (err) {
    if (sshHost) {
      log.error(
        { err },
        `[github] Failed to detect repo via SSH (${sshHost}:${cwd})`,
      )
    }
    repoCache.set(cacheKey, null)
    return null
  }
}

// Helper to wrap execFile in a Promise
function execFileAsync(
  cmd: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (err, stdout) => {
      resolve(err ? '' : stdout)
    })
  })
}

interface GhPR {
  number: number
  title: string
  body: string
  headRefName: string
  url: string
  createdAt: string
  updatedAt: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: string
  reviews: {
    id: string
    author: { login: string }
    state: string
    body: string
  }[]
  reviewRequests: { login: string }[]
  comments: {
    id: string
    url: string
    author: { login: string }
    body: string
    createdAt: string
  }[]
  statusCheckRollup: {
    name: string
    status: string
    conclusion: string
    detailsUrl: string
  }[]
}

function fetchOpenPRs(
  owner: string,
  repo: string,
  force = false,
): Promise<PRCheckStatus[]> {
  return new Promise((resolve) => {
    const repoKey = `${owner}/${repo}`
    const cached = checksCache.get(repoKey)

    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      resolve(cached.prs)
      return
    }

    execFile(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--author',
        ghUsername || '@me',
        '--state',
        'open',
        '--json',
        'number,title,body,headRefName,url,createdAt,updatedAt,statusCheckRollup,reviewDecision,reviews,reviewRequests,comments,mergeable',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(cached?.prs ?? [])
          return
        }

        try {
          const prs: GhPR[] = JSON.parse(stdout)

          // Build initial results without code review comments
          const resultsWithoutCodeComments: {
            result: PRCheckStatus
            issueComments: PRComment[]
          }[] = []

          for (const pr of prs) {
            const allChecks = pr.statusCheckRollup || []
            const areAllChecksOk =
              allChecks.length > 0 &&
              allChecks.every(
                (c) =>
                  c.status === 'COMPLETED' &&
                  (c.conclusion === 'SUCCESS' ||
                    c.conclusion === 'SKIPPED' ||
                    c.conclusion === 'NEUTRAL'),
              )

            // Filter checks to non-success
            const failedChecks: FailedPRCheck[] = allChecks
              .filter(
                (c) =>
                  c.status === 'IN_PROGRESS' ||
                  c.status === 'QUEUED' ||
                  (c.status === 'COMPLETED' &&
                    c.conclusion !== 'SUCCESS' &&
                    c.conclusion !== 'SKIPPED' &&
                    c.conclusion !== 'NEUTRAL'),
              )
              .map((c) => ({
                name: c.name,
                status: c.status,
                conclusion: c.conclusion || '',
                detailsUrl: c.detailsUrl || '',
              }))

            // Extract reviews (APPROVED / CHANGES_REQUESTED / COMMENTED)
            const pendingReviewers = new Set(
              (pr.reviewRequests || []).map((r) => r.login),
            )
            const reviews: PRReview[] = (pr.reviews || [])
              .filter(
                (r) =>
                  r.state === 'APPROVED' ||
                  r.state === 'CHANGES_REQUESTED' ||
                  r.state === 'COMMENTED',
              )
              .map((r) => ({
                id: decodeNodeId(r.id) ?? undefined,
                author: r.author.login,
                avatarUrl: `https://github.com/${r.author.login}.png?size=32`,
                // If reviewer has a pending re-review request, mark as PENDING
                state:
                  r.state === 'CHANGES_REQUESTED' &&
                  pendingReviewers.has(r.author.login)
                    ? 'PENDING'
                    : r.state,
                body: r.body || '',
              }))

            // Deduplicate reviews: keep latest per author
            const reviewsByAuthor = new Map<string, PRReview>()
            for (const r of reviews) {
              reviewsByAuthor.set(r.author, r)
            }

            // Extract issue comments (code review comments fetched separately)
            const issueComments: PRComment[] = (pr.comments || [])
              .filter((c) => !c.author.login.includes('[bot]'))
              .map((c) => ({
                id: decodeNodeId(c.id) ?? undefined,
                url: c.url,
                author: c.author.login,
                avatarUrl: `https://github.com/${c.author.login}.png?size=32`,
                body: c.body,
                createdAt: c.createdAt,
              }))

            // Derive review decision, accounting for re-requested reviews
            const dedupedReviews = Array.from(reviewsByAuthor.values())
            const hasActiveChangesRequested = dedupedReviews.some(
              (r) => r.state === 'CHANGES_REQUESTED',
            )
            const hasApproval = dedupedReviews.some(
              (r) => r.state === 'APPROVED',
            )
            const hasPending = dedupedReviews.some((r) => r.state === 'PENDING')

            let reviewDecision:
              | 'APPROVED'
              | 'CHANGES_REQUESTED'
              | 'REVIEW_REQUIRED'
              | ''
            if (hasActiveChangesRequested) {
              reviewDecision = 'CHANGES_REQUESTED'
            } else if (hasPending) {
              // All changes-requested reviewers have been re-requested
              reviewDecision = 'REVIEW_REQUIRED'
            } else if (hasApproval) {
              reviewDecision = 'APPROVED'
            } else {
              reviewDecision = (pr.reviewDecision ||
                '') as typeof reviewDecision
            }

            resultsWithoutCodeComments.push({
              result: {
                prNumber: pr.number,
                prTitle: pr.title,
                prUrl: pr.url,
                prBody: pr.body || '',
                branch: pr.headRefName,
                repo: repoKey,
                state: 'OPEN',
                reviewDecision,
                reviews: Array.from(reviewsByAuthor.values()),
                checks: failedChecks,
                comments: [], // Will be filled after fetching code review comments
                createdAt: pr.createdAt || '',
                updatedAt: pr.updatedAt || '',
                areAllChecksOk,
                mergeable: pr.mergeable || 'UNKNOWN',
              },
              issueComments,
            })
          }

          // Now fetch code review comments for each PR in parallel
          if (resultsWithoutCodeComments.length === 0) {
            checksCache.set(repoKey, { prs: [], fetchedAt: Date.now() })
            resolve([])
            return
          }

          // Fetch code comments for all PRs in parallel using Promise.all
          Promise.all(
            resultsWithoutCodeComments.map(async ({ result }) => {
              const stdout = await execFileAsync(
                'gh',
                [
                  'api',
                  `repos/${owner}/${repo}/pulls/${result.prNumber}/comments`,
                ],
                { timeout: 10000, maxBuffer: 5 * 1024 * 1024 },
              )
              let codeComments: PRComment[] = []
              try {
                const codeCommentsRaw: {
                  id: number
                  html_url: string
                  user: { login: string }
                  body: string
                  created_at: string
                  path: string
                }[] = JSON.parse(stdout) || []
                codeComments = codeCommentsRaw
                  .filter((c) => !c.user.login.includes('[bot]'))
                  .map((c) => ({
                    id: c.id,
                    url: c.html_url,
                    author: c.user.login,
                    avatarUrl: `https://github.com/${c.user.login}.png?size=32`,
                    body: c.body,
                    createdAt: c.created_at,
                    path: c.path,
                  }))
              } catch {
                // ignore parse errors
              }
              return { prNumber: result.prNumber, codeComments }
            }),
          ).then((codeCommentsResults) => {
            const codeCommentsByPR = new Map<number, PRComment[]>()
            for (const { prNumber, codeComments } of codeCommentsResults) {
              codeCommentsByPR.set(prNumber, codeComments)
            }

            // Merge comments for each PR
            const allResults: PRCheckStatus[] = resultsWithoutCodeComments.map(
              ({ result, issueComments }) => {
                const codeComments = codeCommentsByPR.get(result.prNumber) || []
                const mergedComments = [...issueComments, ...codeComments]
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime(),
                  )
                  .slice(0, 50)
                return { ...result, comments: mergedComments }
              },
            )

            checksCache.set(repoKey, {
              prs: allResults,
              fetchedAt: Date.now(),
            })
            resolve(allResults)
          })
        } catch {
          resolve(cached?.prs ?? [])
        }
      },
    )
  })
}

/** Fetch merged PRs for specific branches (lightweight, no reviews/comments/checks). */
function fetchMergedPRsForBranches(
  owner: string,
  repo: string,
  branches: Set<string>,
): Promise<PRCheckStatus[]> {
  if (branches.size === 0) return Promise.resolve([])

  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--author',
        ghUsername || '@me',
        '--state',
        'merged',
        '--limit',
        '30',
        '--json',
        'number,title,headRefName,url,createdAt,updatedAt',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([])
          return
        }

        try {
          const prs: GhPR[] = JSON.parse(stdout)
          const repoKey = `${owner}/${repo}`
          const results: PRCheckStatus[] = prs
            .filter((pr) => branches.has(pr.headRefName))
            .map((pr) => ({
              prNumber: pr.number,
              prTitle: pr.title,
              prUrl: pr.url,
              prBody: '',
              branch: pr.headRefName,
              repo: repoKey,
              state: 'MERGED' as const,
              reviewDecision: '' as const,
              reviews: [],
              checks: [],
              comments: [],
              createdAt: pr.createdAt || '',
              updatedAt: pr.updatedAt || '',
              areAllChecksOk: false,
            }))
          resolve(results)
        } catch {
          resolve([])
        }
      },
    )
  })
}

/** Fetch merged PRs by @me for a repo, with pagination. */
export function fetchMergedPRsByMe(
  owner: string,
  repo: string,
  limit: number,
  offset: number,
): Promise<{ prs: MergedPRSummary[]; hasMore: boolean }> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--author',
        ghUsername || '@me',
        '--state',
        'merged',
        '--limit',
        String(offset + limit + 1),
        '--json',
        'number,title,headRefName,url',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ prs: [], hasMore: false })
          return
        }
        try {
          const all: {
            number: number
            title: string
            headRefName: string
            url: string
          }[] = JSON.parse(stdout)
          const sliced = all.slice(offset, offset + limit)
          const repoKey = `${owner}/${repo}`
          resolve({
            prs: sliced.map((pr) => ({
              prNumber: pr.number,
              prTitle: pr.title,
              prUrl: pr.url,
              branch: pr.headRefName,
              repo: repoKey,
            })),
            hasMore: all.length > offset + limit,
          })
        } catch {
          resolve({ prs: [], hasMore: false })
        }
      },
    )
  })
}

async function refreshSSHBranch(terminalId: number): Promise<void> {
  try {
    const terminal = await getTerminalById(terminalId)
    if (!terminal?.ssh_host) return

    const result = await execSSHCommand(
      terminal.ssh_host,
      'git rev-parse --abbrev-ref HEAD',
      terminal.cwd,
    )
    const branch = result.stdout.trim()
    if (branch) {
      await updateTerminal(terminalId, { git_branch: branch })
      getIO()?.emit('terminal:updated', { terminalId })
    }
  } catch (err) {
    log.error(
      { err },
      `[github] Failed to refresh SSH branch for terminal ${terminalId}`,
    )
  }
}

async function pollAllPRChecks(force = false): Promise<void> {
  if (ghAvailable === false) return

  // Fetch GitHub username if not cached (needed for --author filter)
  if (ghUsername === null) {
    ghUsername = await fetchGhUsername()
  }

  // Collect unique repos and their terminal branches
  const repoData = new Map<
    string,
    { owner: string; repo: string; branches: Set<string> }
  >()

  for (const [terminalId] of monitoredTerminals) {
    try {
      const terminal = await getTerminalById(terminalId)
      if (!terminal) continue

      // SSH terminals lack shell integration, so refresh branch on each poll
      if (terminal.ssh_host) {
        await refreshSSHBranch(terminalId)
      }

      const repo = await detectGitHubRepo(terminal.cwd, terminal.ssh_host)
      if (!repo) continue

      const key = `${repo.owner}/${repo.repo}`
      const existing = repoData.get(key)
      if (existing) {
        if (terminal.git_branch) existing.branches.add(terminal.git_branch)
      } else {
        repoData.set(key, {
          owner: repo.owner,
          repo: repo.repo,
          branches: new Set(terminal.git_branch ? [terminal.git_branch] : []),
        })
      }
    } catch (err) {
      log.error(
        { err },
        `[github] Failed to detect repo for terminal ${terminalId}`,
      )
    }
  }

  const allPRs: PRCheckStatus[] = []

  for (const [, { owner, repo, branches }] of repoData) {
    try {
      const openPRs = await fetchOpenPRs(owner, repo, force)
      allPRs.push(...openPRs)

      // Only check merged for branches that don't already have an open PR
      const openBranches = new Set(openPRs.map((pr) => pr.branch))
      const branchesWithoutOpenPR = new Set(
        [...branches].filter((b) => !openBranches.has(b)),
      )

      if (branchesWithoutOpenPR.size > 0) {
        const mergedPRs = await fetchMergedPRsForBranches(
          owner,
          repo,
          branchesWithoutOpenPR,
        )
        allPRs.push(...mergedPRs)
      }
    } catch (err) {
      log.error({ err }, `[github] Failed to fetch PRs for ${owner}/${repo}`)
    }
  }

  // Process PR data for server-side notifications
  await processNewPRData(allPRs)

  lastEmittedPRs = allPRs
  getIO()?.emit('github:pr-checks', { prs: allPRs, username: ghUsername })

  // Log GraphQL rate limit after fetching PRs
  execFile(
    'gh',
    ['api', 'rate_limit', '--jq', '.resources.graphql.remaining'],
    { timeout: 5000 },
    (err, stdout) => {
      if (!err && stdout) {
        log.info(`[github] GraphQL rate limit remaining: ${stdout.trim()}`)
      }
    },
  )
}

let lastRefreshAt = 0

interface PollUntilOptions {
  repo: string
  prNumber: number
  until: (pr: PRCheckStatus | undefined) => boolean
}

let activePollId = 0

export async function refreshPRChecks(
  force = false,
  poll?: PollUntilOptions,
): Promise<void> {
  const now = Date.now()
  if (!force && now - lastRefreshAt < REFRESH_MIN_INTERVAL) return

  if (ghAvailable === null) {
    ghAvailable = await checkGhAvailable()
  }
  if (!ghAvailable) return

  if (poll) {
    const myPollId = ++activePollId
    for (let i = 0; i < 6; i++) {
      checksCache.delete(poll.repo)
      await pollAllPRChecks(true)
      lastRefreshAt = Date.now()
      const match = lastEmittedPRs.find(
        (pr) => pr.repo === poll.repo && pr.prNumber === poll.prNumber,
      )
      if (poll.until(match)) return
      if (activePollId !== myPollId) return
      if (i < 5) await new Promise((r) => setTimeout(r, 1200))
    }
    return
  }

  lastRefreshAt = now
  await pollAllPRChecks(force)
}

export async function trackTerminal(terminalId: number): Promise<void> {
  const terminal = await getTerminalById(terminalId)
  if (!terminal) return

  // Auto-detect git_repo for terminals that don't have one set
  if (!terminal.git_repo) {
    const repo = await detectGitHubRepo(terminal.cwd, terminal.ssh_host)
    if (repo) {
      const gitRepoObj = {
        repo: `${repo.owner}/${repo.repo}`,
        status: 'done' as const,
      }
      await updateTerminal(terminalId, { git_repo: gitRepoObj })
      getIO()?.emit('terminal:workspace', {
        terminalId,
        name: terminal.name || terminal.cwd,
        git_repo: gitRepoObj,
      })
    }
  }

  // Auto-detect conductor.json for terminals that don't have setup set
  if (!terminal.setup) {
    let hasConductor = false
    if (terminal.ssh_host) {
      try {
        const conductorPath = `${terminal.cwd.replace(/\/+$/, '')}/conductor.json`
        const result = await execSSHCommand(
          terminal.ssh_host,
          `test -f "${conductorPath}" && echo "yes"`,
          terminal.cwd,
        )
        hasConductor = result.stdout.trim() === 'yes'
      } catch {
        // ignore
      }
    } else {
      hasConductor = fs.existsSync(path.join(terminal.cwd, 'conductor.json'))
    }

    if (hasConductor) {
      const setupObj = { conductor: true, status: 'done' as const }
      await updateTerminal(terminalId, { setup: setupObj })
      getIO()?.emit('terminal:workspace', {
        terminalId,
        name: terminal.name || terminal.cwd,
        setup: setupObj,
      })
    }
  }

  // Detect git branch for SSH terminals (they lack shell integration events)
  if (terminal.ssh_host && !terminal.git_branch) {
    detectGitBranch(terminalId, { skipPRRefresh: true })
  }

  if (ghAvailable === null) {
    ghAvailable = await checkGhAvailable()
  }
  if (!ghAvailable) return

  monitoredTerminals.set(terminalId, terminal.cwd)
}

export function untrackTerminal(terminalId: number): void {
  monitoredTerminals.delete(terminalId)
  stopChecksPolling()
}

export function startChecksPolling(): void {
  if (globalChecksPollingId) return
  if (monitoredTerminals.size === 0) return
  globalChecksPollingId = setInterval(pollAllPRChecks, POLL_INTERVAL)
  // Do an initial fetch
  pollAllPRChecks()
}

export function stopChecksPolling(): void {
  if (globalChecksPollingId && monitoredTerminals.size === 0) {
    clearInterval(globalChecksPollingId)
    globalChecksPollingId = null
  }
}

export async function fetchPRComments(
  owner: string,
  repo: string,
  prNumber: number,
  limit: number,
  offset: number,
  excludeAuthors?: string[],
): Promise<{ comments: PRComment[]; total: number }> {
  // Fetch both issue comments and code review comments in parallel
  const [issueCommentsStdout, codeCommentsStdout] = await Promise.all([
    execFileAsync(
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--repo',
        `${owner}/${repo}`,
        '--json',
        'comments',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
    ),
    execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
        '--paginate',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
    ),
  ])

  let issueCommentsData: {
    id: string
    url: string
    author: { login: string }
    body: string
    createdAt: string
  }[] = []
  let codeCommentsData: {
    id: number
    html_url: string
    user: { login: string }
    body: string
    created_at: string
    path: string
  }[] = []

  try {
    const data = JSON.parse(issueCommentsStdout)
    issueCommentsData = data.comments || []
  } catch {
    // ignore parse errors
  }

  try {
    codeCommentsData = JSON.parse(codeCommentsStdout) || []
  } catch {
    // ignore parse errors
  }

  const excludeSet = excludeAuthors ? new Set(excludeAuthors) : null
  // Merge issue comments and code review comments
  const issueComments = issueCommentsData.map((c) => ({
    id: decodeNodeId(c.id) ?? undefined,
    author: c.author.login,
    body: c.body,
    createdAt: c.createdAt,
    url: c.url,
    path: undefined as string | undefined,
  }))
  const codeComments = codeCommentsData.map((c) => ({
    id: c.id,
    author: c.user.login,
    body: c.body,
    createdAt: c.created_at,
    url: c.html_url,
    path: c.path,
  }))
  const allComments = [...issueComments, ...codeComments]
  const filtered = allComments.filter(
    (c) =>
      !c.author.includes('[bot]') && (!excludeSet || !excludeSet.has(c.author)),
  )
  const total = filtered.length
  // Sort by date descending
  const sorted = filtered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const sliced = sorted.slice(offset, offset + limit).map((c) => ({
    url: c.url,
    author: c.author,
    avatarUrl: `https://github.com/${c.author}.png?size=32`,
    body: c.body,
    createdAt: c.createdAt,
    path: c.path,
  }))
  return { comments: sliced, total }
}

export function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Use REST API to avoid deprecated projectCards GraphQL field in `gh pr edit`
    execFile(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
        '-f',
        `reviewers[]=${reviewer}`,
      ],
      { timeout: 15000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        checksCache.delete(`${owner}/${repo}`)
        resolve({ ok: true })
      },
    )
  })
}

export function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase',
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'api',
        '--method',
        'PUT',
        `repos/${owner}/${repo}/pulls/${prNumber}/merge`,
        '-f',
        `merge_method=${method}`,
      ],
      { timeout: 30000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        checksCache.delete(`${owner}/${repo}`)
        resolve({ ok: true })
      },
    )
  })
}

export function rerunFailedCheck(
  owner: string,
  repo: string,
  checkUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const runMatch = checkUrl.match(/actions\/runs\/(\d+)/)
  if (!runMatch) {
    return Promise.resolve({
      ok: false,
      error: 'Cannot rerun: unsupported check type',
    })
  }
  const runId = runMatch[1]
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
      ],
      { timeout: 30000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        checksCache.delete(`${owner}/${repo}`)
        resolve({ ok: true })
      },
    )
  })
}

/** Re-run all failed checks by extracting unique run IDs and calling rerun-failed-jobs for each. */
export async function rerunAllFailedChecks(
  owner: string,
  repo: string,
  checkUrls: string[],
): Promise<{ ok: boolean; error?: string; rerunCount: number }> {
  // Extract unique run IDs from URLs
  const runIds = new Set<string>()
  for (const url of checkUrls) {
    const match = url.match(/actions\/runs\/(\d+)/)
    if (match) {
      runIds.add(match[1])
    }
  }

  if (runIds.size === 0) {
    return { ok: false, error: 'No valid action runs found', rerunCount: 0 }
  }

  const errors: string[] = []
  let successCount = 0

  // Rerun each unique workflow run
  await Promise.all(
    [...runIds].map(
      (runId) =>
        new Promise<void>((resolve) => {
          execFile(
            'gh',
            [
              'api',
              '--method',
              'POST',
              `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
            ],
            { timeout: 30000 },
            (err, _stdout, stderr) => {
              if (err) {
                errors.push(stderr || err.message)
              } else {
                successCount++
              }
              resolve()
            },
          )
        }),
    ),
  )

  checksCache.delete(`${owner}/${repo}`)

  if (successCount === 0) {
    return { ok: false, error: errors[0] || 'All reruns failed', rerunCount: 0 }
  }

  return { ok: true, rerunCount: successCount }
}

export function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'pr',
        'comment',
        String(prNumber),
        '--repo',
        `${owner}/${repo}`,
        '-b',
        body,
      ],
      { timeout: 15000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        checksCache.delete(`${owner}/${repo}`)
        resolve({ ok: true })
      },
    )
  })
}

/** Send the last polled PR data to a specific socket (e.g. on connect). */
export function emitCachedPRChecks(socket: {
  emit: (ev: string, data: unknown) => void
}): void {
  if (lastEmittedPRs.length > 0) {
    socket.emit('github:pr-checks', { prs: lastEmittedPRs })
  }
}

export async function detectAllTerminalBranches(): Promise<void> {
  log.info(
    `[github] detecting branches for ${monitoredTerminals.size} terminals`,
  )
  await Promise.all(
    [...monitoredTerminals.keys()].map((id) =>
      detectGitBranch(id, { skipPRRefresh: true }),
    ),
  )
  // Single PR refresh after all branches are detected, instead of per-terminal
  refreshPRChecks()
}

export async function initGitHubChecks(): Promise<void> {
  ghAvailable = await checkGhAvailable()
  if (!ghAvailable) return

  const terminals = await getAllTerminals()
  for (const terminal of terminals) {
    monitoredTerminals.set(terminal.id, terminal.cwd)
  }

  if (monitoredTerminals.size > 0) {
    startChecksPolling()
  }
}

// Webhook queue functions

export function queueWebhookRefresh(repo: string): void {
  webhookQueue.pendingRepos.add(repo)

  if (webhookQueue.timer) return

  webhookQueue.timer = setTimeout(async () => {
    const repos = Array.from(webhookQueue.pendingRepos)
    webhookQueue.pendingRepos.clear()
    webhookQueue.timer = null

    log.info(`[github] Webhook triggered PR refresh for: ${repos.join(', ')}`)

    // Clear cache for affected repos and refresh
    for (const repo of repos) {
      checksCache.delete(repo)
    }
    await refreshPRChecks(true)
  }, WEBHOOK_THROTTLE_MS)
}

function isHiddenAuthor(
  hiddenAuthors: HiddenGHAuthor[] | undefined,
  repo: string,
  author: string,
): boolean {
  if (!hiddenAuthors) return false
  return hiddenAuthors.some((h) => h.repo === repo && h.author === author)
}

async function processNewPRData(newPRs: PRCheckStatus[]): Promise<void> {
  if (!initialFullFetchDone) {
    // First fetch - just store data, don't create notifications
    for (const pr of newPRs) {
      const key = `${pr.repo}#${pr.prNumber}`
      lastPRData.set(key, pr)
    }
    initialFullFetchDone = true
    return
  }

  const settings = await getSettings()
  const hiddenAuthors = settings.hide_gh_authors
  const io = getIO()

  for (const pr of newPRs) {
    const key = `${pr.repo}#${pr.prNumber}`
    const prev = lastPRData.get(key)

    // PR merged
    if (prev && prev.state !== 'MERGED' && pr.state === 'MERGED') {
      const notification = await insertNotification(
        'pr_merged',
        pr.repo,
        pr.prNumber,
        { prTitle: pr.prTitle, prUrl: pr.prUrl },
      )
      if (notification) {
        io?.emit('notifications:new', notification)
      }
    }

    // Check failed
    const hasFailedChecks = (p: PRCheckStatus) =>
      p.checks.some(
        (c) =>
          c.status === 'COMPLETED' &&
          c.conclusion !== 'SUCCESS' &&
          c.conclusion !== 'SKIPPED' &&
          c.conclusion !== 'NEUTRAL',
      )
    if (prev && !hasFailedChecks(prev) && hasFailedChecks(pr)) {
      const failedCheck = pr.checks.find(
        (c) =>
          c.status === 'COMPLETED' &&
          c.conclusion !== 'SUCCESS' &&
          c.conclusion !== 'SKIPPED' &&
          c.conclusion !== 'NEUTRAL',
      )
      const notification = await insertNotification(
        'check_failed',
        pr.repo,
        pr.prNumber,
        {
          prTitle: pr.prTitle,
          prUrl: pr.prUrl,
          checkName: failedCheck?.name,
          checkUrl: failedCheck?.detailsUrl,
        },
        failedCheck?.detailsUrl || failedCheck?.name,
      )
      if (notification) {
        io?.emit('notifications:new', notification)
      }
    }

    // Changes requested
    if (
      prev &&
      prev.reviewDecision !== 'CHANGES_REQUESTED' &&
      pr.reviewDecision === 'CHANGES_REQUESTED'
    ) {
      const reviewer = pr.reviews.find(
        (r) => r.state === 'CHANGES_REQUESTED',
      )?.author
      if (!isHiddenAuthor(hiddenAuthors, pr.repo, reviewer || '')) {
        const notification = await insertNotification(
          'changes_requested',
          pr.repo,
          pr.prNumber,
          { prTitle: pr.prTitle, prUrl: pr.prUrl, reviewer },
          reviewer,
        )
        if (notification) {
          io?.emit('notifications:new', notification)
        }
      }
    }

    // Approved
    if (
      prev &&
      prev.reviewDecision !== 'APPROVED' &&
      pr.reviewDecision === 'APPROVED'
    ) {
      const approver = pr.reviews.find((r) => r.state === 'APPROVED')?.author
      if (!isHiddenAuthor(hiddenAuthors, pr.repo, approver || '')) {
        const notification = await insertNotification(
          'pr_approved',
          pr.repo,
          pr.prNumber,
          { prTitle: pr.prTitle, prUrl: pr.prUrl, approver },
          approver,
        )
        if (notification) {
          io?.emit('notifications:new', notification)
        }
      }
    }

    // New comments
    if (prev && pr.comments.length > 0) {
      const prevCommentIds = new Set(
        prev.comments.map((c) => c.id).filter(Boolean),
      )
      for (const comment of pr.comments) {
        if (ghUsername && comment.author === ghUsername) continue
        if (isHiddenAuthor(hiddenAuthors, pr.repo, comment.author)) continue
        // Skip if we've seen this comment before (by ID)
        if (comment.id && prevCommentIds.has(comment.id)) continue
        const notification = await insertNotification(
          'new_comment',
          pr.repo,
          pr.prNumber,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            author: comment.author,
            body: comment.body.substring(0, 200),
            commentUrl: comment.url,
          },
          comment.id
            ? String(comment.id)
            : `${comment.author}:${comment.createdAt}`,
        )
        if (notification) {
          io?.emit('notifications:new', notification)
        }
      }
    }

    // New reviews
    if (prev && pr.reviews.length > 0) {
      const prevReviewIds = new Set(
        prev.reviews.map((r) => r.id).filter(Boolean),
      )
      for (const review of pr.reviews) {
        if (ghUsername && review.author === ghUsername) continue
        if (isHiddenAuthor(hiddenAuthors, pr.repo, review.author)) continue
        // Skip if we've seen this review before (by ID)
        if (review.id && prevReviewIds.has(review.id)) continue
        const notification = await insertNotification(
          'new_review',
          pr.repo,
          pr.prNumber,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            author: review.author,
            state: review.state,
            body: review.body?.substring(0, 200),
            reviewId: review.id,
          },
          review.id ? String(review.id) : `${review.author}:${review.state}`,
        )
        if (notification) {
          io?.emit('notifications:new', notification)
        }
      }
    }

    // Update stored data
    lastPRData.set(key, pr)
  }

  // Clean up removed PRs from lastPRData
  const currentKeys = new Set(newPRs.map((pr) => `${pr.repo}#${pr.prNumber}`))
  for (const key of lastPRData.keys()) {
    if (!currentKeys.has(key)) {
      lastPRData.delete(key)
    }
  }
}
