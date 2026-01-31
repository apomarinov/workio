import { execFile } from 'node:child_process'
import type {
  FailedPRCheck,
  MergedPRSummary,
  PRCheckStatus,
  PRComment,
  PRReview,
} from '../../shared/types'
import { getAllTerminals, getTerminalById, updateTerminal } from '../db'
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
let globalChecksPollingId: NodeJS.Timeout | null = null
let lastEmittedPRs: PRCheckStatus[] = []

const POLL_INTERVAL = 60_000 // 60 seconds
const CACHE_TTL = 30_000 // 30 seconds

function parseGitHubRemoteUrl(
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

interface GhPR {
  number: number
  title: string
  headRefName: string
  url: string
  createdAt: string
  updatedAt: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: string
  reviews: { author: { login: string }; state: string; body: string }[]
  reviewRequests: { login: string }[]
  comments: {
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

function fetchOpenPRs(owner: string, repo: string): Promise<PRCheckStatus[]> {
  return new Promise((resolve) => {
    const repoKey = `${owner}/${repo}`
    const cached = checksCache.get(repoKey)

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
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
        '@me',
        '--state',
        'open',
        '--json',
        'number,title,headRefName,url,createdAt,updatedAt,statusCheckRollup,reviewDecision,reviews,reviewRequests,comments,mergeable',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(cached?.prs ?? [])
          return
        }

        try {
          const prs: GhPR[] = JSON.parse(stdout)
          const allResults: PRCheckStatus[] = []

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

            // Extract reviews (APPROVED / CHANGES_REQUESTED only)
            const pendingReviewers = new Set(
              (pr.reviewRequests || []).map((r) => r.login),
            )
            const reviews: PRReview[] = (pr.reviews || [])
              .filter(
                (r) =>
                  r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED',
              )
              .map((r) => ({
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

            // Extract comments, filter bots, newest first, limit 5
            const comments: PRComment[] = (pr.comments || [])
              .filter((c) => !c.author.login.includes('[bot]'))
              .reverse()
              .slice(0, 5)
              .map((c) => ({
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

            allResults.push({
              prNumber: pr.number,
              prTitle: pr.title,
              prUrl: pr.url,
              branch: pr.headRefName,
              repo: repoKey,
              state: 'OPEN',
              reviewDecision,
              reviews: Array.from(reviewsByAuthor.values()),
              checks: failedChecks,
              comments,
              createdAt: pr.createdAt || '',
              updatedAt: pr.updatedAt || '',
              areAllChecksOk,
              mergeable: pr.mergeable || 'UNKNOWN',
            })
          }

          checksCache.set(repoKey, {
            prs: allResults,
            fetchedAt: Date.now(),
          })
          resolve(allResults)
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
        '@me',
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
        '@me',
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

async function pollAllPRChecks(): Promise<void> {
  if (ghAvailable === false) return

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
      const openPRs = await fetchOpenPRs(owner, repo)
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

  lastEmittedPRs = allPRs
  getIO()?.emit('github:pr-checks', { prs: allPRs })

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
const REFRESH_MIN_INTERVAL = 10_000 // 10 seconds

export async function refreshPRChecks(): Promise<void> {
  const now = Date.now()
  if (now - lastRefreshAt < REFRESH_MIN_INTERVAL) return
  lastRefreshAt = now

  if (ghAvailable === null) {
    ghAvailable = await checkGhAvailable()
  }
  if (!ghAvailable) return

  await pollAllPRChecks()
}

export async function trackTerminal(terminalId: number): Promise<void> {
  if (ghAvailable === null) {
    ghAvailable = await checkGhAvailable()
  }
  if (!ghAvailable) return

  const terminal = await getTerminalById(terminalId)
  if (!terminal) return

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

export function fetchPRComments(
  owner: string,
  repo: string,
  prNumber: number,
  limit: number,
  offset: number,
  excludeAuthors?: string[],
): Promise<{ comments: PRComment[]; total: number }> {
  return new Promise((resolve) => {
    execFile(
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
      (err, stdout) => {
        if (err) {
          resolve({ comments: [], total: 0 })
          return
        }
        try {
          const data: {
            comments: {
              author: { login: string }
              body: string
              createdAt: string
            }[]
          } = JSON.parse(stdout)

          const excludeSet = excludeAuthors ? new Set(excludeAuthors) : null
          const filtered = (data.comments || []).filter(
            (c) =>
              !c.author.login.includes('[bot]') &&
              (!excludeSet || !excludeSet.has(c.author.login)),
          )
          const total = filtered.length
          const sliced = filtered
            .reverse()
            .slice(offset, offset + limit)
            .map((c) => ({
              author: c.author.login,
              avatarUrl: `https://github.com/${c.author.login}.png?size=32`,
              body: c.body,
              createdAt: c.createdAt,
            }))
          resolve({ comments: sliced, total })
        } catch {
          resolve({ comments: [], total: 0 })
        }
      },
    )
  })
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
