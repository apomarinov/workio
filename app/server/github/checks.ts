import { execFile } from 'node:child_process'
import type {
  FailedPRCheck,
  PRCheckStatus,
  PRComment,
  PRReview,
} from '../../shared/types'
import { getAllTerminals, getTerminalById } from '../db'
import { getIO } from '../io'

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
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/)
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

function detectGitHubRepo(
  cwd: string,
): Promise<{ owner: string; repo: string } | null> {
  return new Promise((resolve) => {
    if (repoCache.has(cwd)) {
      resolve(repoCache.get(cwd)!)
      return
    }

    execFile(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) {
          repoCache.set(cwd, null)
          resolve(null)
          return
        }
        const result = parseGitHubRemoteUrl(stdout.trim())
        repoCache.set(cwd, result)
        resolve(result)
      },
    )
  })
}

interface GhPR {
  number: number
  title: string
  headRefName: string
  url: string
  reviewDecision: string
  reviews: { author: { login: string }; state: string }[]
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

function fetchPRChecks(
  owner: string,
  repo: string,
  branches: Set<string>,
): Promise<PRCheckStatus[]> {
  return new Promise((resolve) => {
    const repoKey = `${owner}/${repo}`
    const cached = checksCache.get(repoKey)

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      // Return cached but re-filter for current branches
      resolve(cached.prs.filter((pr) => branches.has(pr.branch)))
      return
    }

    execFile(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--state',
        'open',
        '--json',
        'number,title,headRefName,url,statusCheckRollup,reviewDecision,reviews,comments',
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(cached?.prs.filter((pr) => branches.has(pr.branch)) ?? [])
          return
        }

        try {
          const prs: GhPR[] = JSON.parse(stdout)
          const allResults: PRCheckStatus[] = []

          for (const pr of prs) {
            // Filter checks to non-success
            const failedChecks: FailedPRCheck[] = (pr.statusCheckRollup || [])
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
            const reviews: PRReview[] = (pr.reviews || [])
              .filter(
                (r) =>
                  r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED',
              )
              .map((r) => ({
                author: r.author.login,
                avatarUrl: `https://github.com/${r.author.login}.png?size=32`,
                state: r.state,
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

            const reviewDecision = (pr.reviewDecision || '') as
              | 'APPROVED'
              | 'CHANGES_REQUESTED'
              | 'REVIEW_REQUIRED'
              | ''

            allResults.push({
              prNumber: pr.number,
              prTitle: pr.title,
              prUrl: pr.url,
              branch: pr.headRefName,
              repo: repoKey,
              reviewDecision,
              reviews: Array.from(reviewsByAuthor.values()),
              checks: failedChecks,
              comments,
            })
          }

          checksCache.set(repoKey, {
            prs: allResults,
            fetchedAt: Date.now(),
          })
          resolve(allResults.filter((pr) => branches.has(pr.branch)))
        } catch {
          resolve(cached?.prs.filter((pr) => branches.has(pr.branch)) ?? [])
        }
      },
    )
  })
}

async function pollAllPRChecks(): Promise<void> {
  if (ghAvailable === false) return

  // Collect unique repos and their branches
  const repoToBranches = new Map<
    string,
    { owner: string; repo: string; branches: Set<string> }
  >()

  for (const [terminalId] of monitoredTerminals) {
    const terminal = getTerminalById(terminalId)
    if (!terminal || terminal.ssh_host || !terminal.git_branch) continue

    const repo = await detectGitHubRepo(terminal.cwd)
    if (!repo) continue

    const key = `${repo.owner}/${repo.repo}`
    const existing = repoToBranches.get(key)
    if (existing) {
      existing.branches.add(terminal.git_branch)
    } else {
      repoToBranches.set(key, {
        owner: repo.owner,
        repo: repo.repo,
        branches: new Set([terminal.git_branch]),
      })
    }
  }

  const allPRs: PRCheckStatus[] = []

  for (const [, { owner, repo, branches }] of repoToBranches) {
    const prs = await fetchPRChecks(owner, repo, branches)
    allPRs.push(...prs)
  }

  lastEmittedPRs = allPRs
  getIO()?.emit('github:pr-checks', { prs: allPRs })
}

export async function refreshPRChecks(): Promise<void> {
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

  const terminal = getTerminalById(terminalId)
  if (!terminal || terminal.ssh_host) return

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

/** Send the last polled PR data to a specific socket (e.g. on connect). */
export function emitCachedPRChecks(socket: {
  emit: (ev: string, data: unknown) => void
}): void {
  if (lastEmittedPRs.length > 0) {
    socket.emit('github:pr-checks', { prs: lastEmittedPRs })
  }
}

export async function initGitHubChecks(): Promise<void> {
  ghAvailable = await checkGhAvailable()
  if (!ghAvailable) return

  const terminals = getAllTerminals()
  for (const terminal of terminals) {
    if (!terminal.ssh_host) {
      monitoredTerminals.set(terminal.id, terminal.cwd)
    }
  }

  if (monitoredTerminals.size > 0) {
    startChecksPolling()
  }
}
