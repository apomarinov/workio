import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {
  FailedPRCheck,
  MergedPRSummary,
  PRCheckStatus,
  PRComment,
  PRDiscussionItem,
  PRReview,
  PRReviewThread,
} from '../../shared/types'
import type { HiddenGHAuthor, HiddenPR } from '../../src/types'
import {
  getAllTerminals,
  getSettings,
  getTerminalById,
  insertNotification,
  logCommand,
  updateTerminal,
} from '../db'
import { getIO } from '../io'
import { log } from '../logger'
import { detectGitBranch } from '../pty/manager'
import { execSSHCommand } from '../ssh/exec'

// Cache: cwd -> { owner, repo } or null
const repoCache = new Map<string, { owner: string; repo: string } | null>()

// Unified cache for all PRs
let lastFetchedAt = 0
let lastFetchedPRs: PRCheckStatus[] = []

function invalidateChecksCache(): void {
  lastFetchedAt = 0
}

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
// Track commit SHAs that had check_failed notifications to suppress
// false checks_passed notifications when a failed check is retried (same commit)
const checkFailedOnCommit = new Map<string, string>()
let initialFullFetchDone = false

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

export function getGhUsername(): string | null {
  return ghUsername
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

// GitHub GraphQL rate limit cost = sum of (first/last values multiplied across nesting levels).
// Keep limits low: we rarely have >10 open PRs, >20 checks, >10 reviews, etc.
const GRAPHQL_QUERY = `query($openQ: String!, $closedQ: String!, $openFirst: Int!, $closedFirst: Int!) {
  rateLimit { cost remaining }
  openPRs: search(query: $openQ, type: ISSUE, first: $openFirst) {
    nodes {
      ... on PullRequest {
        number
        title
        body
        headRefName
        url
        createdAt
        updatedAt
        state
        mergeable
        reviewDecision
        repository { nameWithOwner }
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                contexts(first: 30) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      detailsUrl
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                    }
                  }
                }
              }
            }
          }
        }
        reviews(last: 10) {
          nodes {
            databaseId
            url
            author { login }
            state
            body
            submittedAt
          }
        }
        reviewRequests(first: 10) {
          nodes {
            requestedReviewer {
              ... on User { login }
            }
          }
        }
        comments(last: 20) {
          nodes {
            databaseId
            url
            author { login }
            body
            createdAt
          }
        }
        reviewThreads(last: 20) {
          nodes {
            comments(first: 10) {
              nodes {
                databaseId
                url
                author { login }
                body
                createdAt
                path
                pullRequestReview {
                  databaseId
                }
              }
            }
          }
        }
      }
    }
  }
  closedPRs: search(query: $closedQ, type: ISSUE, first: $closedFirst) {
    nodes {
      ... on PullRequest {
        number
        title
        headRefName
        url
        createdAt
        updatedAt
        state
        repository { nameWithOwner }
      }
    }
  }
}`

interface GraphQLCheckContext {
  __typename: 'CheckRun' | 'StatusContext'
  // CheckRun fields
  name?: string
  status?: string
  conclusion?: string | null
  detailsUrl?: string
  // StatusContext fields
  context?: string
  state?: string
  targetUrl?: string
}

interface GraphQLOpenPR {
  number: number
  title: string
  body: string
  headRefName: string
  url: string
  createdAt: string
  updatedAt: string
  state: 'OPEN'
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: string | null
  repository: { nameWithOwner: string }
  commits: {
    nodes: {
      commit: {
        oid: string
        statusCheckRollup: {
          contexts: { nodes: GraphQLCheckContext[] }
        } | null
      }
    }[]
  }
  reviews: {
    nodes: {
      databaseId: number
      url: string
      author: { login: string }
      state: string
      body: string
      submittedAt: string
    }[]
  }
  reviewRequests: {
    nodes: { requestedReviewer: { login?: string } }[]
  }
  comments: {
    nodes: {
      databaseId: number
      url: string
      author: { login: string }
      body: string
      createdAt: string
    }[]
  }
  reviewThreads: {
    nodes: {
      comments: {
        nodes: {
          databaseId: number
          url: string
          author: { login: string }
          body: string
          createdAt: string
          path: string
          pullRequestReview: { databaseId: number } | null
        }[]
      }
    }[]
  }
}

interface GraphQLClosedPR {
  number: number
  title: string
  headRefName: string
  url: string
  createdAt: string
  updatedAt: string
  state: 'MERGED' | 'CLOSED'
  repository: { nameWithOwner: string }
}

function normalizeCheckContext(ctx: GraphQLCheckContext): {
  name: string
  status: string
  conclusion: string
  detailsUrl: string
} {
  if (ctx.__typename === 'CheckRun') {
    return {
      name: ctx.name || '',
      status: ctx.status || '',
      conclusion: ctx.conclusion || '',
      detailsUrl: ctx.detailsUrl || '',
    }
  }
  // StatusContext
  const name = ctx.context || ''
  const ghState = ctx.state || ''
  let status: string
  let conclusion: string
  if (ghState === 'SUCCESS') {
    status = 'COMPLETED'
    conclusion = 'SUCCESS'
  } else if (ghState === 'PENDING') {
    status = 'IN_PROGRESS'
    conclusion = ''
  } else {
    // FAILURE, ERROR
    status = 'COMPLETED'
    conclusion = 'FAILURE'
  }
  return { name, status, conclusion, detailsUrl: ctx.targetUrl || '' }
}

function getDiscussionItemTime(item: PRDiscussionItem): number {
  switch (item.type) {
    case 'review':
      return item.review.submittedAt
        ? new Date(item.review.submittedAt).getTime()
        : 0
    case 'comment':
      return new Date(item.comment.createdAt).getTime()
    case 'thread':
      return item.thread.comments[0]
        ? new Date(item.thread.comments[0].createdAt).getTime()
        : 0
  }
}

function sortDiscussion(discussion: PRDiscussionItem[]): void {
  discussion.sort((a, b) => getDiscussionItemTime(b) - getDiscussionItemTime(a))
}

function mapOpenPRNode(pr: GraphQLOpenPR): PRCheckStatus {
  const repoKey = pr.repository.nameWithOwner

  // Normalize checks from commits → statusCheckRollup → contexts
  const commitNode = pr.commits.nodes[0]
  const headCommitSha = commitNode?.commit?.oid || ''
  const contexts = commitNode?.commit?.statusCheckRollup?.contexts?.nodes || []
  const allChecks = contexts.map(normalizeCheckContext)

  const areAllChecksOk =
    allChecks.length > 0 &&
    allChecks.every(
      (c) =>
        c.status === 'COMPLETED' &&
        (c.conclusion === 'SUCCESS' ||
          c.conclusion === 'SKIPPED' ||
          c.conclusion === 'NEUTRAL'),
    )

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
      conclusion: c.conclusion,
      detailsUrl: c.detailsUrl,
    }))

  // Reviews
  const pendingReviewers = new Set(
    (pr.reviewRequests?.nodes || [])
      .map((r) => r.requestedReviewer?.login)
      .filter(Boolean) as string[],
  )

  const allReviewNodes = (pr.reviews?.nodes || []).filter(
    (r) =>
      r.state === 'APPROVED' ||
      r.state === 'CHANGES_REQUESTED' ||
      r.state === 'COMMENTED',
  )

  // "Real" reviews: non-COMMENTED, or COMMENTED with body
  const realReviewIds = new Set<number>()
  for (const r of allReviewNodes) {
    if (r.state !== 'COMMENTED' || r.body) {
      realReviewIds.add(r.databaseId)
    }
  }

  const reviews: PRReview[] = allReviewNodes
    .filter((r) => realReviewIds.has(r.databaseId))
    .map((r) => ({
      id: r.databaseId,
      url: r.url,
      author: r.author.login,
      avatarUrl: `https://github.com/${r.author.login}.png?size=32`,
      state:
        r.state === 'CHANGES_REQUESTED' && pendingReviewers.has(r.author.login)
          ? 'PENDING'
          : r.state,
      body: r.body || '',
      submittedAt: r.submittedAt,
    }))

  const reviewsByAuthor = new Map<string, PRReview>()
  for (const r of reviews) {
    reviewsByAuthor.set(r.author, r)
  }

  // Issue comments
  const issueComments: PRComment[] = (pr.comments?.nodes || [])
    .filter((c) => !c.author.login.includes('[bot]'))
    .map((c) => ({
      id: c.databaseId,
      url: c.url,
      author: c.author.login,
      avatarUrl: `https://github.com/${c.author.login}.png?size=32`,
      body: c.body,
      createdAt: c.createdAt,
    }))

  // Code comments from reviewThreads (flat, for notifications)
  const codeComments: PRComment[] = (pr.reviewThreads?.nodes || []).flatMap(
    (thread) =>
      (thread.comments?.nodes || [])
        .filter((c) => !c.author.login.includes('[bot]'))
        .map((c) => ({
          id: c.databaseId,
          url: c.url,
          author: c.author.login,
          avatarUrl: `https://github.com/${c.author.login}.png?size=32`,
          body: c.body,
          createdAt: c.createdAt,
          path: c.path,
        })),
  )

  // Merge and deduplicate comments by id, sort by date desc, cap at 50
  const seenIds = new Set<number>()
  const mergedComments: PRComment[] = []
  for (const c of [...issueComments, ...codeComments]) {
    if (c.id && seenIds.has(c.id)) continue
    if (c.id) seenIds.add(c.id)
    mergedComments.push(c)
  }
  mergedComments.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const comments = mergedComments.slice(0, 50)

  // Build discussion timeline
  // 1. Build threads from reviewThreads
  const reviewIdToThreads = new Map<number, PRReviewThread[]>()
  const standaloneThreads: PRReviewThread[] = []

  for (const threadNode of pr.reviewThreads?.nodes || []) {
    const threadComments: PRComment[] = (threadNode.comments?.nodes || [])
      .filter((c) => !c.author.login.includes('[bot]'))
      .map((c) => ({
        id: c.databaseId,
        url: c.url,
        author: c.author.login,
        avatarUrl: `https://github.com/${c.author.login}.png?size=32`,
        body: c.body,
        createdAt: c.createdAt,
        path: c.path,
      }))

    if (threadComments.length === 0) continue

    const rootCommentNode = threadNode.comments?.nodes?.[0]
    const threadPath = rootCommentNode?.path || ''
    const thread: PRReviewThread = {
      path: threadPath,
      comments: threadComments,
    }

    // Check if root comment's review is a "real" review
    const rootReviewId = rootCommentNode?.pullRequestReview?.databaseId
    if (rootReviewId && realReviewIds.has(rootReviewId)) {
      const existing = reviewIdToThreads.get(rootReviewId) || []
      existing.push(thread)
      reviewIdToThreads.set(rootReviewId, existing)
    } else {
      standaloneThreads.push(thread)
    }
  }

  // 2. Build discussion items
  const discussion: PRDiscussionItem[] = []

  // Real reviews with their threads
  for (const review of reviews) {
    const threads = review.id ? reviewIdToThreads.get(review.id) || [] : []
    discussion.push({ type: 'review', review, threads })
  }

  // Issue comments
  for (const comment of issueComments) {
    discussion.push({ type: 'comment', comment })
  }

  // Standalone threads
  for (const thread of standaloneThreads) {
    discussion.push({ type: 'thread', thread })
  }

  // Sort chronologically ascending
  sortDiscussion(discussion)

  // Review decision
  const dedupedReviews = Array.from(reviewsByAuthor.values())
  const hasActiveChangesRequested = dedupedReviews.some(
    (r) => r.state === 'CHANGES_REQUESTED',
  )
  const hasApproval = dedupedReviews.some((r) => r.state === 'APPROVED')
  const hasPending = dedupedReviews.some((r) => r.state === 'PENDING')

  let reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  if (hasActiveChangesRequested) {
    reviewDecision = 'CHANGES_REQUESTED'
  } else if (hasPending) {
    reviewDecision = 'REVIEW_REQUIRED'
  } else if (hasApproval) {
    reviewDecision = 'APPROVED'
  } else {
    reviewDecision = (pr.reviewDecision || '') as typeof reviewDecision
  }

  const runningChecksCount = failedChecks.filter(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED',
  ).length
  const failedChecksCount = failedChecks.filter(
    (c) =>
      c.status === 'COMPLETED' &&
      c.conclusion !== 'SUCCESS' &&
      c.conclusion !== 'SKIPPED' &&
      c.conclusion !== 'NEUTRAL',
  ).length

  return {
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    prBody: pr.body || '',
    branch: pr.headRefName,
    repo: repoKey,
    state: 'OPEN',
    reviewDecision,
    reviews: dedupedReviews,
    checks: failedChecks,
    comments,
    discussion,
    createdAt: pr.createdAt || '',
    updatedAt: pr.updatedAt || '',
    areAllChecksOk,
    mergeable: pr.mergeable || 'UNKNOWN',
    isMerged: false,
    isApproved: reviewDecision === 'APPROVED',
    hasChangesRequested: reviewDecision === 'CHANGES_REQUESTED',
    hasConflicts: pr.mergeable === 'CONFLICTING',
    hasPendingReviews: hasPending,
    hasFailedChecks: failedChecksCount > 0,
    runningChecksCount,
    failedChecksCount,
    headCommitSha,
  }
}

function mapClosedPRNode(pr: GraphQLClosedPR): PRCheckStatus {
  return {
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    prBody: '',
    branch: pr.headRefName,
    repo: pr.repository.nameWithOwner,
    state: pr.state,
    reviewDecision: '',
    reviews: [],
    checks: [],
    comments: [],
    discussion: [],
    createdAt: pr.createdAt || '',
    updatedAt: pr.updatedAt || '',
    areAllChecksOk: false,
    isMerged: pr.state === 'MERGED',
    isApproved: false,
    hasChangesRequested: false,
    hasConflicts: false,
    hasPendingReviews: false,
    hasFailedChecks: false,
    runningChecksCount: 0,
    failedChecksCount: 0,
    headCommitSha: '',
  }
}

/** Fetch all open + closed PRs across all repos in a single GraphQL call. */
function fetchAllPRsViaGraphQL(
  repos: string[],
  trackedBranches: Map<string, Set<string>>,
  force = false,
): Promise<{ openPRs: PRCheckStatus[]; closedPRs: PRCheckStatus[] }> {
  if (!force && Date.now() - lastFetchedAt < CACHE_TTL) {
    // Filter cached results to only repos we care about
    const repoSet = new Set(repos)
    return Promise.resolve({
      openPRs: lastFetchedPRs.filter(
        (pr) => pr.state === 'OPEN' && repoSet.has(pr.repo),
      ),
      closedPRs: lastFetchedPRs.filter(
        (pr) => pr.state !== 'OPEN' && repoSet.has(pr.repo),
      ),
    })
  }

  if (repos.length === 0) {
    return Promise.resolve({ openPRs: [], closedPRs: [] })
  }

  const author = ghUsername || '@me'
  const repoFilter = repos.map((r) => `repo:${r}`).join(' ')
  const openQ = `is:pr is:open author:${author} ${repoFilter}`
  const closedQ = `is:pr is:closed author:${author} ${repoFilter} sort:updated-desc`

  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${GRAPHQL_QUERY}`,
        '-f',
        `openQ=${openQ}`,
        '-f',
        `closedQ=${closedQ}`,
        '-F',
        'openFirst=20',
        '-F',
        'closedFirst=20',
      ],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({
            openPRs: lastFetchedPRs.filter((pr) => pr.state === 'OPEN'),
            closedPRs: lastFetchedPRs.filter((pr) => pr.state !== 'OPEN'),
          })
          return
        }

        try {
          const resp = JSON.parse(stdout)

          // Log rate limit from the response itself
          const rl = resp.data?.rateLimit
          if (rl) {
            log.info(
              `[github] GraphQL rate limit: cost=${rl.cost} remaining=${rl.remaining}`,
            )
          }

          const openNodes: GraphQLOpenPR[] = (
            resp.data.openPRs.nodes as GraphQLOpenPR[]
          ).filter((n) => n.number != null)
          const closedNodes: GraphQLClosedPR[] = (
            resp.data.closedPRs.nodes as GraphQLClosedPR[]
          ).filter((n) => n.number != null)

          const openPRs = openNodes.map(mapOpenPRNode)

          // Filter closed PRs: only branches in trackedBranches without an open PR
          const openBranches = new Map<string, Set<string>>()
          for (const pr of openPRs) {
            const existing = openBranches.get(pr.repo)
            if (existing) {
              existing.add(pr.branch)
            } else {
              openBranches.set(pr.repo, new Set([pr.branch]))
            }
          }

          const closedPRs = closedNodes
            .filter((n) => {
              const repo = n.repository.nameWithOwner
              const branchSet = trackedBranches.get(repo)
              if (!branchSet || !branchSet.has(n.headRefName)) return false
              const openSet = openBranches.get(repo)
              return !openSet || !openSet.has(n.headRefName)
            })
            .map(mapClosedPRNode)

          // Update cache
          lastFetchedAt = Date.now()
          lastFetchedPRs = [...openPRs, ...closedPRs]

          resolve({ openPRs, closedPRs })
        } catch {
          resolve({
            openPRs: lastFetchedPRs.filter((pr) => pr.state === 'OPEN'),
            closedPRs: lastFetchedPRs.filter((pr) => pr.state !== 'OPEN'),
          })
        }
      },
    )
  })
}

/** Fetch closed/merged PRs by @me across all repos in a single GraphQL call. */
export function fetchAllClosedPRs(
  repos: string[],
  limit: number,
): Promise<MergedPRSummary[]> {
  if (repos.length === 0) return Promise.resolve([])
  const repoFilter = repos.map((r) => `repo:${r}`).join(' ')
  const author = ghUsername || '@me'
  const searchQuery = `is:pr is:closed author:${author} ${repoFilter}`
  const graphqlQuery = `query($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        state
        headRefName
        repository { nameWithOwner }
      }
    }
  }
}`
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${graphqlQuery}`,
        '-f',
        `q=${searchQuery}`,
        '-F',
        `first=${Math.min(limit, 100)}`,
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        try {
          const resp = JSON.parse(stdout)
          const nodes: {
            number: number
            title: string
            url: string
            state: 'MERGED' | 'CLOSED'
            headRefName: string
            repository: { nameWithOwner: string }
          }[] = resp.data.search.nodes
          resolve(
            nodes
              .filter((n) => n.number != null)
              .map((n) => ({
                prNumber: n.number,
                prTitle: n.title,
                prUrl: n.url,
                branch: n.headRefName,
                repo: n.repository.nameWithOwner,
                state: n.state,
              })),
          )
        } catch {
          resolve([])
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
      getIO()?.emit('terminal:updated', {
        terminalId,
        data: { git_branch: branch },
      })
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

  // Collect all repos + tracked branches (including previously-open PRs from lastPRData)
  const allRepos = [...repoData.keys()]
  const allBranches = new Map<string, Set<string>>()
  for (const [key, { branches }] of repoData) {
    const branchSet = allBranches.get(key) || new Set<string>()
    for (const b of branches) branchSet.add(b)
    // Also include branches from previously-open PRs in lastPRData
    for (const [, pr] of lastPRData) {
      if (pr.repo === key && pr.state === 'OPEN' && pr.branch) {
        branchSet.add(pr.branch)
      }
    }
    allBranches.set(key, branchSet)
  }

  let allPRs: PRCheckStatus[]
  try {
    const { openPRs, closedPRs } = await fetchAllPRsViaGraphQL(
      allRepos,
      allBranches,
      force,
    )
    allPRs = [...openPRs, ...closedPRs]
  } catch (err) {
    log.error({ err }, '[github] Failed to fetch PRs via GraphQL')
    allPRs = []
  }

  // Process PR data for server-side notifications
  await processNewPRData(allPRs)

  await emitPRChecks(allPRs)
}

async function emitPRChecks(allPRs: PRCheckStatus[]): Promise<void> {
  const settings = await getSettings()
  const visiblePRs = allPRs.filter(
    (pr) => !isHiddenPR(settings.hidden_prs, pr.repo, pr.prNumber),
  )
  lastEmittedPRs = visiblePRs
  getIO()?.emit('github:pr-checks', { prs: visiblePRs, username: ghUsername })
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
      invalidateChecksCache()
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
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method POST repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers -f reviewers[]=${reviewer}`
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
      (err, stdout, stderr) => {
        logCommand({
          prId,
          category: 'github',
          command: cmd,
          stdout,
          stderr,
          failed: !!err,
        })
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        invalidateChecksCache()
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
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method PUT repos/${owner}/${repo}/pulls/${prNumber}/merge -f merge_method=${method}`
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
      (err, stdout, stderr) => {
        logCommand({
          prId,
          category: 'github',
          command: cmd,
          stdout,
          stderr,
          failed: !!err,
        })
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        invalidateChecksCache()
        resolve({ ok: true })
      },
    )
  })
}

export function closePR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ ok: boolean; error?: string }> {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f state=closed`
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'api',
        '--method',
        'PATCH',
        `repos/${owner}/${repo}/pulls/${prNumber}`,
        '-f',
        'state=closed',
      ],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        logCommand({
          prId,
          category: 'github',
          command: cmd,
          stdout,
          stderr,
          failed: !!err,
        })
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        invalidateChecksCache()
        resolve({ ok: true })
      },
    )
  })
}

export function rerunFailedCheck(
  owner: string,
  repo: string,
  checkUrl: string,
  prNumber?: number,
): Promise<{ ok: boolean; error?: string }> {
  const runMatch = checkUrl.match(/actions\/runs\/(\d+)/)
  if (!runMatch) {
    return Promise.resolve({
      ok: false,
      error: 'Cannot rerun: unsupported check type',
    })
  }
  const runId = runMatch[1]
  const prId = prNumber ? `${owner}/${repo}#${prNumber}` : undefined
  const cmd = `gh api --method POST repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`
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
      (err, stdout, stderr) => {
        logCommand({
          prId,
          category: 'github',
          command: cmd,
          stdout,
          stderr,
          failed: !!err,
        })
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        invalidateChecksCache()
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
  prNumber?: number,
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

  const prId = prNumber ? `${owner}/${repo}#${prNumber}` : undefined
  const errors: string[] = []
  let successCount = 0

  // Rerun each unique workflow run
  await Promise.all(
    [...runIds].map(
      (runId) =>
        new Promise<void>((resolve) => {
          const cmd = `gh api --method POST repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`
          execFile(
            'gh',
            [
              'api',
              '--method',
              'POST',
              `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
            ],
            { timeout: 30000 },
            (err, stdout, stderr) => {
              logCommand({
                prId,
                category: 'github',
                command: cmd,
                stdout,
                stderr,
                failed: !!err,
              })
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

  invalidateChecksCache()

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
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh pr comment ${prNumber} --repo ${owner}/${repo} -b "..."`
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
      (err, stdout, stderr) => {
        logCommand({
          prId,
          category: 'github',
          command: cmd,
          stdout,
          stderr,
          failed: !!err,
        })
        if (err) {
          resolve({ ok: false, error: stderr || err.message })
          return
        }
        invalidateChecksCache()
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

    invalidateChecksCache()
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

function isSilencedAuthor(
  silencedAuthors: HiddenGHAuthor[] | undefined,
  repo: string,
  author: string,
): boolean {
  if (!silencedAuthors) return false
  return silencedAuthors.some((h) => h.repo === repo && h.author === author)
}

function isHiddenPR(
  hiddenPRs: HiddenPR[] | undefined,
  repo: string,
  prNumber: number,
): boolean {
  if (!hiddenPRs) return false
  return hiddenPRs.some((h) => h.repo === repo && h.prNumber === prNumber)
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
  const silencedAuthors = settings.silence_gh_authors
  const io = getIO()

  for (const pr of newPRs) {
    const key = `${pr.repo}#${pr.prNumber}`
    const prev = lastPRData.get(key)

    // PR merged
    if (prev && prev.state !== 'MERGED' && pr.state === 'MERGED') {
      const notification = await insertNotification(
        'pr_merged',
        pr.repo,
        { prTitle: pr.prTitle, prUrl: pr.prUrl },
        undefined,
        pr.prNumber,
      )
      if (notification) {
        io?.emit('notifications:new', notification)
      }
    }

    // PR closed (not merged)
    if (prev && prev.state !== 'CLOSED' && pr.state === 'CLOSED') {
      const notification = await insertNotification(
        'pr_closed',
        pr.repo,
        { prTitle: pr.prTitle, prUrl: pr.prUrl },
        undefined,
        pr.prNumber,
      )
      if (notification) {
        io?.emit('notifications:new', notification)
      }
    }

    // Check failed
    if (prev && !prev.hasFailedChecks && pr.hasFailedChecks) {
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
        {
          prTitle: pr.prTitle,
          prUrl: pr.prUrl,
          checkName: failedCheck?.name,
          checkUrl: failedCheck?.detailsUrl,
        },
        `${failedCheck?.detailsUrl || failedCheck?.name}:${pr.updatedAt}`,
        pr.prNumber,
      )
      if (notification) {
        io?.emit('notifications:new', notification)
      }
      // Track that this commit had a check failure, so we can suppress
      // the false "checks_passed" notification when a failed check is retried
      if (pr.headCommitSha) {
        checkFailedOnCommit.set(key, pr.headCommitSha)
      }
    }

    // Clear check-failed tracking when commit changes (new push)
    if (
      prev &&
      pr.headCommitSha &&
      prev.headCommitSha &&
      prev.headCommitSha !== pr.headCommitSha
    ) {
      checkFailedOnCommit.delete(key)
    }

    // Checks passed — skip if this is just a retry of a previously failed check
    // on the same commit (not a fresh push)
    if (prev && !prev.areAllChecksOk && pr.areAllChecksOk) {
      const failedSha = checkFailedOnCommit.get(key)
      if (!failedSha || failedSha !== pr.headCommitSha) {
        const notification = await insertNotification(
          'checks_passed',
          pr.repo,
          { prTitle: pr.prTitle, prUrl: pr.prUrl },
          pr.updatedAt,
          pr.prNumber,
        )
        if (notification) {
          io?.emit('notifications:new', notification)
        }
      }
      checkFailedOnCommit.delete(key)
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
      if (
        reviewer &&
        reviewer !== ghUsername &&
        !isHiddenAuthor(hiddenAuthors, pr.repo, reviewer) &&
        !isSilencedAuthor(silencedAuthors, pr.repo, reviewer)
      ) {
        const notification = await insertNotification(
          'changes_requested',
          pr.repo,
          { prTitle: pr.prTitle, prUrl: pr.prUrl, reviewer },
          `${reviewer}:${pr.updatedAt}`,
          pr.prNumber,
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
      if (
        approver &&
        approver !== ghUsername &&
        !isHiddenAuthor(hiddenAuthors, pr.repo, approver) &&
        !isSilencedAuthor(silencedAuthors, pr.repo, approver)
      ) {
        const notification = await insertNotification(
          'pr_approved',
          pr.repo,
          { prTitle: pr.prTitle, prUrl: pr.prUrl, approver },
          `${approver}:${pr.updatedAt}`,
          pr.prNumber,
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
        if (isSilencedAuthor(silencedAuthors, pr.repo, comment.author)) continue
        // Skip if we've seen this comment before (by ID)
        if (comment.id && prevCommentIds.has(comment.id)) continue
        const notification = await insertNotification(
          'new_comment',
          pr.repo,
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
          pr.prNumber,
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
        if (isSilencedAuthor(silencedAuthors, pr.repo, review.author)) continue
        // Skip if we've seen this review before (by ID)
        if (review.id && prevReviewIds.has(review.id)) continue
        // Skip reviews with no body - these are just containers for code comments
        // which are already captured by new_comment notifications
        if (!review.body) continue
        const notification = await insertNotification(
          'new_review',
          pr.repo,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            author: review.author,
            state: review.state,
            body: review.body?.substring(0, 200),
            reviewId: review.id,
          },
          review.id ? String(review.id) : `${review.author}:${review.state}`,
          pr.prNumber,
        )
        if (notification) {
          io?.emit('notifications:new', notification)
        }
      }
    }

    // Update stored data (clone so in-place mutations don't alias prev snapshots)
    lastPRData.set(key, structuredClone(pr))
  }

  // Clean up removed PRs from lastPRData and checkFailedOnCommit
  const currentKeys = new Set(newPRs.map((pr) => `${pr.repo}#${pr.prNumber}`))
  for (const key of lastPRData.keys()) {
    if (!currentKeys.has(key)) {
      lastPRData.delete(key)
      checkFailedOnCommit.delete(key)
    }
  }
}

// --- Webhook optimistic patching ---

interface WebhookPayload {
  repository?: { full_name?: string }
  action?: string
  pull_request?: {
    number: number
    title: string
    body?: string
    head?: { ref: string }
    html_url: string
    state: string
    merged?: boolean
    mergeable?: boolean | null
    mergeable_state?: string
    created_at: string
    updated_at: string
    user?: { login?: string }
  }
  review?: {
    id: number
    html_url?: string
    user: { login: string }
    state: string
    body: string
    submitted_at: string
  }
  comment?: {
    id: number
    html_url: string
    user: { login: string }
    body: string
    created_at: string
    path?: string
    pull_request_review_id?: number
    in_reply_to_id?: number
  }
  issue?: {
    number: number
    user?: { login?: string }
    pull_request?: { url: string }
  }
}

function findPR(repo: string, prNumber: number): PRCheckStatus | undefined {
  return lastFetchedPRs.find(
    (pr) => pr.repo === repo && pr.prNumber === prNumber,
  )
}

function patchPullRequest(repo: string, payload: WebhookPayload): boolean {
  const prData = payload.pull_request
  if (!prData) return false

  const existing = findPR(repo, prData.number)

  if (payload.action === 'opened') {
    if (existing) return false // already tracked
    const newPR: PRCheckStatus = {
      prNumber: prData.number,
      prTitle: prData.title,
      prUrl: prData.html_url,
      prBody: prData.body || '',
      branch: prData.head?.ref || '',
      repo,
      state: 'OPEN',
      reviewDecision: '',
      reviews: [],
      checks: [],
      comments: [],
      discussion: [],
      createdAt: prData.created_at || '',
      updatedAt: prData.updated_at || '',
      areAllChecksOk: false,
      mergeable: 'UNKNOWN',
      isMerged: false,
      isApproved: false,
      hasChangesRequested: false,
      hasConflicts: false,
      hasPendingReviews: false,
      hasFailedChecks: false,
      runningChecksCount: 0,
      failedChecksCount: 0,
      headCommitSha: '',
    }
    lastFetchedPRs = [...lastFetchedPRs, newPR]
    return true
  }

  if (!existing) return false

  if (
    payload.action === 'closed' ||
    payload.action === 'reopened' ||
    payload.action === 'edited' ||
    payload.action === 'synchronize'
  ) {
    if (payload.action === 'closed') {
      existing.state = prData.merged ? 'MERGED' : 'CLOSED'
      existing.isMerged = !!prData.merged
    } else if (payload.action === 'reopened') {
      existing.state = 'OPEN'
      existing.isMerged = false
    }

    existing.prTitle = prData.title
    existing.prBody = prData.body ?? existing.prBody
    existing.branch = prData.head?.ref ?? existing.branch
    existing.updatedAt = prData.updated_at || existing.updatedAt

    if (prData.mergeable === true) {
      existing.mergeable = 'MERGEABLE'
      existing.hasConflicts = false
    } else if (prData.mergeable === false) {
      existing.mergeable = 'CONFLICTING'
      existing.hasConflicts = true
    }

    return true
  }

  return false
}

function patchPullRequestReview(
  repo: string,
  payload: WebhookPayload,
): boolean {
  if (payload.action !== 'submitted') return false
  const review = payload.review
  const prNumber = payload.pull_request?.number
  if (!review || !prNumber) return false

  const existing = findPR(repo, prNumber)
  if (!existing) return false

  const mappedState =
    review.state === 'approved'
      ? 'APPROVED'
      : review.state === 'changes_requested'
        ? 'CHANGES_REQUESTED'
        : review.state === 'commented'
          ? 'COMMENTED'
          : review.state.toUpperCase()

  // Only track meaningful review states
  if (
    mappedState !== 'APPROVED' &&
    mappedState !== 'CHANGES_REQUESTED' &&
    mappedState !== 'COMMENTED'
  ) {
    return false
  }

  const newReview: PRReview = {
    id: review.id,
    url: review.html_url,
    author: review.user.login,
    avatarUrl: `https://github.com/${review.user.login}.png?size=32`,
    state: mappedState,
    body: review.body || '',
    submittedAt: review.submitted_at,
  }

  // Dedup by author: replace existing review from same author, or append
  const idx = existing.reviews.findIndex((r) => r.author === review.user.login)
  if (idx >= 0) {
    existing.reviews[idx] = newReview
  } else {
    existing.reviews.push(newReview)
  }

  // Patch discussion: only add "real" reviews (non-COMMENTED or has body)
  const isRealReview = mappedState !== 'COMMENTED' || review.body
  if (isRealReview) {
    const discIdx = existing.discussion.findIndex(
      (d) => d.type === 'review' && d.review.id === review.id,
    )
    if (discIdx >= 0) {
      const prev = existing.discussion[discIdx] as {
        type: 'review'
        review: PRReview
        threads: PRReviewThread[]
      }
      existing.discussion[discIdx] = {
        type: 'review',
        review: newReview,
        threads: prev.threads,
      }
    } else {
      existing.discussion.push({
        type: 'review',
        review: newReview,
        threads: [],
      })
    }
    sortDiscussion(existing.discussion)
  }

  // Recompute review decision
  const hasChangesRequested = existing.reviews.some(
    (r) => r.state === 'CHANGES_REQUESTED',
  )
  const hasApproval = existing.reviews.some((r) => r.state === 'APPROVED')
  const hasPending = existing.reviews.some((r) => r.state === 'PENDING')

  if (hasChangesRequested) {
    existing.reviewDecision = 'CHANGES_REQUESTED'
  } else if (hasPending) {
    existing.reviewDecision = 'REVIEW_REQUIRED'
  } else if (hasApproval) {
    existing.reviewDecision = 'APPROVED'
  }
  existing.isApproved = existing.reviewDecision === 'APPROVED'
  existing.hasChangesRequested = existing.reviewDecision === 'CHANGES_REQUESTED'
  existing.hasPendingReviews = hasPending

  return true
}

function patchIssueComment(repo: string, payload: WebhookPayload): boolean {
  if (payload.action !== 'created') return false
  const comment = payload.comment
  const issueNumber = payload.issue?.number
  // Only patch if this issue is actually a PR (has pull_request field)
  if (!comment || !issueNumber || !payload.issue?.pull_request) return false

  const existing = findPR(repo, issueNumber)
  if (!existing) return false

  // Skip bot comments
  if (comment.user.login.includes('[bot]')) return false

  const newComment: PRComment = {
    id: comment.id,
    url: comment.html_url,
    author: comment.user.login,
    avatarUrl: `https://github.com/${comment.user.login}.png?size=32`,
    body: comment.body,
    createdAt: comment.created_at,
  }

  // Prepend and maintain sort + cap at 50
  existing.comments = [newComment, ...existing.comments]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 50)

  // Patch discussion
  existing.discussion.push({ type: 'comment', comment: newComment })
  sortDiscussion(existing.discussion)

  return true
}

function patchReviewComment(repo: string, payload: WebhookPayload): boolean {
  if (payload.action !== 'created') return false
  const comment = payload.comment
  const prNumber = payload.pull_request?.number
  if (!comment || !prNumber) return false

  const existing = findPR(repo, prNumber)
  if (!existing) return false

  // Skip bot comments
  if (comment.user.login.includes('[bot]')) return false

  const newComment: PRComment = {
    id: comment.id,
    url: comment.html_url,
    author: comment.user.login,
    avatarUrl: `https://github.com/${comment.user.login}.png?size=32`,
    body: comment.body,
    createdAt: comment.created_at,
    path: comment.path,
  }

  // Dedup by id, prepend, sort, cap at 50
  const existingIdx = existing.comments.findIndex(
    (c) => c.id && c.id === comment.id,
  )
  if (existingIdx >= 0) return false // already have it

  existing.comments = [newComment, ...existing.comments]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 50)

  // Patch discussion: try to find an existing thread to append to
  const reviewId = comment.pull_request_review_id
  const inReplyToId = comment.in_reply_to_id
  let placed = false

  // If replying to an existing comment, find the thread containing that comment
  if (inReplyToId) {
    for (const item of existing.discussion) {
      if (item.type === 'review') {
        for (const thread of item.threads) {
          if (thread.comments.some((c) => c.id === inReplyToId)) {
            thread.comments.push(newComment)
            placed = true
            break
          }
        }
      } else if (item.type === 'thread') {
        if (item.thread.comments.some((c) => c.id === inReplyToId)) {
          item.thread.comments.push(newComment)
          placed = true
        }
      }
      if (placed) break
    }
  }

  // If not placed as reply, try to attach to a review
  if (!placed && reviewId) {
    const reviewItem = existing.discussion.find(
      (d) => d.type === 'review' && d.review.id === reviewId,
    )
    if (reviewItem && reviewItem.type === 'review') {
      // Find thread with same path or create new one
      const existingThread = reviewItem.threads.find(
        (t) => t.path === (comment.path || ''),
      )
      if (existingThread) {
        existingThread.comments.push(newComment)
      } else {
        reviewItem.threads.push({
          path: comment.path || '',
          comments: [newComment],
        })
      }
      placed = true
    }
  }

  // Otherwise create standalone thread
  if (!placed) {
    existing.discussion.push({
      type: 'thread',
      thread: { path: comment.path || '', comments: [newComment] },
    })
    sortDiscussion(existing.discussion)
  }

  return true
}

function tryApplyWebhookPatch(event: string, payload: WebhookPayload): boolean {
  const repo = payload.repository?.full_name
  if (!repo) return false

  switch (event) {
    case 'pull_request':
      return patchPullRequest(repo, payload)
    case 'pull_request_review':
      return patchPullRequestReview(repo, payload)
    case 'issue_comment':
      return patchIssueComment(repo, payload)
    case 'pull_request_review_comment':
      return patchReviewComment(repo, payload)
    default:
      return false
  }
}

export async function applyWebhookAndRefresh(
  event: string,
  payload: WebhookPayload,
): Promise<void> {
  const repo = payload.repository?.full_name
  if (!repo) return

  // Try to apply optimistic patch
  const patched = tryApplyWebhookPatch(event, payload)

  if (patched) {
    // Process notifications for patched data
    await processNewPRData(lastFetchedPRs)
    // Emit patched data to client immediately
    await emitPRChecks(lastFetchedPRs)
    log.info(`[webhooks] Applied optimistic patch for ${event} on ${repo}`)
  }

  // Always queue background reconcile
  queueWebhookRefresh(repo)
}
