import { getSettings } from '@domains/settings/db'
import {
  DEFAULT_GH_QUERY_LIMITS,
  type GHQueryLimits,
} from '@domains/settings/schema'
import { execFileAsync } from '@server/lib/exec'
import { log } from '@server/logger'
import { execSSHCommand } from '@server/ssh/exec'
import type {
  FailedPRCheck,
  InvolvedPRSummary,
  MergedPRSummary,
  PRCheckStatus,
  PRComment,
  PRDiscussionItem,
  PRReaction,
  PRReview,
  PRReviewThread,
} from '../../schema'
import {
  CACHE_TTL,
  getGhUsername,
  getLastFetchedAt,
  getLastFetchedPRs,
  repoCache,
  setLastFetchedAt,
  setLastFetchedPRs,
} from './state'

// --- GraphQL interfaces ---

interface GraphQLCheckContext {
  __typename: 'CheckRun' | 'StatusContext'
  name?: string
  status?: string
  conclusion?: string | null
  detailsUrl?: string
  startedAt?: string | null
  context?: string
  state?: string
  targetUrl?: string
}

interface GraphQLOpenPR {
  number: number
  title: string
  body: string
  isDraft: boolean
  headRefName: string
  baseRefName: string
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
      reactionGroups?: {
        content: string
        viewerHasReacted: boolean
        reactors: { nodes: { login?: string }[] }
      }[]
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
      reactionGroups?: {
        content: string
        viewerHasReacted: boolean
        reactors: { nodes: { login?: string }[] }
      }[]
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
          reactionGroups?: {
            content: string
            viewerHasReacted: boolean
            reactors: { nodes: { login?: string }[] }
          }[]
        }[]
      }
    }[]
  }
}

// --- Utility functions ---

const GRAPHQL_REACTION_MAP: Record<string, string> = {
  THUMBS_UP: '+1',
  THUMBS_DOWN: '-1',
  LAUGH: 'laugh',
  HOORAY: 'hooray',
  CONFUSED: 'confused',
  HEART: 'heart',
  ROCKET: 'rocket',
  EYES: 'eyes',
}

export function ghExec(
  cmd: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) {
  return execFileAsync(cmd, args, options)
    .then(({ stdout }) => stdout)
    .catch(() => '')
}

export async function checkGhAvailable() {
  try {
    await execFileAsync('gh', ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export async function fetchGhUsername() {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', 'user', '--jq', '.login'],
      { timeout: 5000 },
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

export function parseGitHubRemoteUrl(url: string) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (match) return { owner: match[1], repo: match[2] }
  return null
}

export async function detectGitHubRepo(cwd: string, sshHost?: string | null) {
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
      const result = await execFileAsync(
        'git',
        ['remote', 'get-url', 'origin'],
        { cwd, timeout: 5000 },
      )
      stdout = result.stdout
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

/** Decode GitHub GraphQL node ID to extract database ID (last 4 bytes as big-endian uint32) */
function decodeNodeId(nodeId: string) {
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

function normalizeCheckContext(ctx: GraphQLCheckContext) {
  if (ctx.__typename === 'CheckRun') {
    return {
      name: ctx.name || '',
      status: ctx.status || '',
      conclusion: ctx.conclusion || '',
      detailsUrl: ctx.detailsUrl || '',
      startedAt: ctx.startedAt || '',
    }
  }
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
    status = 'COMPLETED'
    conclusion = 'FAILURE'
  }
  return {
    name,
    status,
    conclusion,
    detailsUrl: ctx.targetUrl || '',
    startedAt: '',
  }
}

function getDiscussionItemTime(item: PRDiscussionItem) {
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

export function sortDiscussion(discussion: PRDiscussionItem[]) {
  discussion.sort((a, b) => getDiscussionItemTime(b) - getDiscussionItemTime(a))
}

function mapReactionGroups(
  groups?: {
    content: string
    viewerHasReacted: boolean
    reactors: { nodes: { login?: string }[] }
  }[],
): PRReaction[] | undefined {
  if (!groups) return undefined
  const reactions = groups
    .filter((r) => r.reactors.nodes.length > 0)
    .map((r) => ({
      content: GRAPHQL_REACTION_MAP[r.content] || r.content.toLowerCase(),
      count: r.reactors.nodes.length,
      viewerHasReacted: r.viewerHasReacted,
      users: r.reactors.nodes
        .map((n) => n.login)
        .filter((l): l is string => !!l),
    }))
  return reactions.length > 0 ? reactions : undefined
}

function getPRDetailFields(limits: GHQueryLimits) {
  return `
number
title
body
isDraft
headRefName
baseRefName
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
        contexts(first: ${limits.checks}) {
          nodes {
            __typename
            ... on CheckRun {
              name
              status
              conclusion
              detailsUrl
              startedAt
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
reviews(last: ${limits.reviews}) {
  nodes {
    databaseId
    url
    author { login }
    state
    body
    submittedAt
    reactionGroups {
      content
      viewerHasReacted
      reactors(first: ${limits.reactors}) {
        nodes { ... on User { login } }
      }
    }
  }
}
reviewRequests(first: ${limits.review_requests}) {
  nodes {
    requestedReviewer {
      ... on User { login }
    }
  }
}
comments(last: ${limits.comments}) {
  nodes {
    databaseId
    url
    author { login }
    body
    createdAt
    reactionGroups {
      content
      viewerHasReacted
      reactors(first: ${limits.reactors}) {
        nodes { ... on User { login } }
      }
    }
  }
}
reviewThreads(last: ${limits.review_threads}) {
  nodes {
    comments(first: ${limits.thread_comments}) {
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
        reactionGroups {
          content
          viewerHasReacted
          reactors(first: ${limits.reactors}) {
            nodes { ... on User { login } }
          }
        }
      }
    }
  }
}
`
}

function mapOpenPRNode(pr: GraphQLOpenPR): PRCheckStatus {
  const repoKey = pr.repository.nameWithOwner

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
      startedAt: c.startedAt,
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
      reactions: mapReactionGroups(r.reactionGroups),
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
      reactions: mapReactionGroups(c.reactionGroups),
    }))

  // Code comments from reviewThreads
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
          reactions: mapReactionGroups(c.reactionGroups),
        })),
  )

  // Merge and deduplicate comments
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
        reactions: mapReactionGroups(c.reactionGroups),
      }))

    if (threadComments.length === 0) continue

    const rootCommentNode = threadNode.comments?.nodes?.[0]
    const threadPath = rootCommentNode?.path || ''
    const thread: PRReviewThread = {
      path: threadPath,
      comments: threadComments,
    }

    const rootReviewId = rootCommentNode?.pullRequestReview?.databaseId
    if (rootReviewId && realReviewIds.has(rootReviewId)) {
      const existing = reviewIdToThreads.get(rootReviewId) || []
      existing.push(thread)
      reviewIdToThreads.set(rootReviewId, existing)
    } else {
      standaloneThreads.push(thread)
    }
  }

  const discussion: PRDiscussionItem[] = []

  for (const review of reviews) {
    const threads = review.id ? reviewIdToThreads.get(review.id) || [] : []
    discussion.push({ type: 'review', review, threads })
  }

  for (const comment of issueComments) {
    discussion.push({ type: 'comment', comment })
  }

  for (const thread of standaloneThreads) {
    discussion.push({ type: 'thread', thread })
  }

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
    baseBranch: pr.baseRefName || '',
    repo: repoKey,
    state: 'OPEN' as const,
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
    isDraft: pr.isDraft ?? false,
  }
}

// --- Main fetch functions ---

export async function fetchAllPRsViaGraphQL(
  repos: string[],
  trackedBranches: Map<string, Set<string>>,
  force = false,
) {
  if (!force && Date.now() - getLastFetchedAt() < CACHE_TTL) {
    const repoSet = new Set(repos)
    return {
      openPRs: getLastFetchedPRs().filter(
        (pr) => pr.state === 'OPEN' && repoSet.has(pr.repo),
      ),
      closedPRs: getLastFetchedPRs().filter(
        (pr) => pr.state !== 'OPEN' && repoSet.has(pr.repo),
      ),
    }
  }

  if (repos.length === 0) {
    return { openPRs: [], closedPRs: [] }
  }

  try {
    return await fetchPRsViaRESTAndGraphQL(repos, trackedBranches)
  } catch (err) {
    log.error({ err }, '[github] Failed to fetch PRs')
    return {
      openPRs: getLastFetchedPRs().filter((pr) => pr.state === 'OPEN'),
      closedPRs: getLastFetchedPRs().filter((pr) => pr.state !== 'OPEN'),
    }
  }
}

async function fetchPRsViaRESTAndGraphQL(
  repos: string[],
  trackedBranches: Map<string, Set<string>>,
) {
  const settings = await getSettings()
  const limits: GHQueryLimits = {
    ...DEFAULT_GH_QUERY_LIMITS,
    ...settings.gh_query_limits,
  }
  const prDetailFields = getPRDetailFields(limits)
  const author = getGhUsername() || 'unknown'

  // Step 1: Discover PRs via REST
  const openPRsByRepo = new Map<string, number[]>()
  const closedRESTData = new Map<
    string,
    Array<{
      number: number
      title: string
      html_url: string
      head: { ref: string }
      base?: { ref: string }
      merged_at: string | null
      created_at: string
      updated_at: string
    }>
  >()

  await Promise.all(
    repos.map(async (repoKey) => {
      const [openStdout, closedStdout] = await Promise.all([
        ghExec(
          'gh',
          ['api', `repos/${repoKey}/pulls?state=open&per_page=100`],
          { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
        ),
        ghExec(
          'gh',
          [
            'api',
            `repos/${repoKey}/pulls?state=closed&per_page=10&sort=updated&direction=desc`,
          ],
          { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
        ),
      ])

      if (openStdout) {
        try {
          const prs = JSON.parse(openStdout) as Array<{
            number: number
            user?: { login?: string }
          }>
          const myPRs = prs
            .filter((pr) => pr.user?.login === author)
            .map((pr) => pr.number)
          if (myPRs.length > 0) {
            openPRsByRepo.set(repoKey, myPRs)
          }
        } catch (err) {
          log.error(
            { err, repo: repoKey },
            '[github] Failed to parse open PRs REST response',
          )
        }
      }

      if (closedStdout) {
        try {
          const prs = JSON.parse(closedStdout) as Array<{
            number: number
            title: string
            html_url: string
            head: { ref: string }
            merged_at: string | null
            created_at: string
            updated_at: string
            user?: { login?: string }
          }>
          const myPRs = prs.filter((pr) => pr.user?.login === author)
          if (myPRs.length > 0) {
            closedRESTData.set(repoKey, myPRs)
          }
        } catch (err) {
          log.error(
            { err, repo: repoKey },
            '[github] Failed to parse closed PRs REST response',
          )
        }
      }
    }),
  )

  // Step 2: Enrich open PRs via GraphQL
  const openPRs: PRCheckStatus[] = []

  if (openPRsByRepo.size > 0) {
    const queryParts: string[] = []
    const prLookup: Array<{ repoIdx: number; prNumber: number }> = []
    let repoIdx = 0
    for (const [repoKey, prNumbers] of openPRsByRepo) {
      const [owner, name] = repoKey.split('/')
      const prAliases = prNumbers.map(
        (n) => `pr_${n}: pullRequest(number: ${n}) {${prDetailFields}}`,
      )
      queryParts.push(
        `repo_${repoIdx}: repository(owner: "${owner}", name: "${name}") {\n${prAliases.join('\n')}\n}`,
      )
      for (const n of prNumbers) {
        prLookup.push({ repoIdx, prNumber: n })
      }
      repoIdx++
    }

    const query = `query {\n${queryParts.join('\n')}\n}`

    const stdout = await ghExec(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
    )

    if (stdout) {
      try {
        const resp = JSON.parse(stdout)

        for (const { repoIdx: ri, prNumber } of prLookup) {
          const prNode = resp.data?.[`repo_${ri}`]?.[`pr_${prNumber}`]
          if (prNode?.number != null) {
            openPRs.push(mapOpenPRNode(prNode as GraphQLOpenPR))
          }
        }
      } catch (e) {
        log.error({ err: e }, '[github] Failed to parse GraphQL PR details')
      }
    }
  }

  // Step 3: Map closed PRs from REST data
  const openBranches = new Map<string, Set<string>>()
  for (const pr of openPRs) {
    const existing = openBranches.get(pr.repo) || new Set<string>()
    existing.add(pr.branch)
    openBranches.set(pr.repo, existing)
  }

  const closedPRs: PRCheckStatus[] = []
  for (const [repoKey, prs] of closedRESTData) {
    const branchSet = trackedBranches.get(repoKey)
    const openSet = openBranches.get(repoKey)

    for (const pr of prs) {
      const branch = pr.head?.ref
      if (!branch) continue
      if (!branchSet || !branchSet.has(branch)) continue
      if (openSet?.has(branch)) continue

      closedPRs.push({
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.html_url,
        prBody: '',
        branch,
        baseBranch: pr.base?.ref || '',
        repo: repoKey,
        state: pr.merged_at ? 'MERGED' : 'CLOSED',
        reviewDecision: '',
        reviews: [],
        checks: [],
        comments: [],
        discussion: [],
        createdAt: pr.created_at || '',
        updatedAt: pr.updated_at || '',
        areAllChecksOk: false,
        isMerged: !!pr.merged_at,
        isApproved: false,
        hasChangesRequested: false,
        hasConflicts: false,
        hasPendingReviews: false,
        hasFailedChecks: false,
        runningChecksCount: 0,
        failedChecksCount: 0,
        headCommitSha: '',
        isDraft: false,
      })
    }
  }

  // Update cache
  setLastFetchedAt(Date.now())
  setLastFetchedPRs([...openPRs, ...closedPRs])

  return { openPRs, closedPRs }
}

export async function fetchAllClosedPRs(repos: string[], limit: number) {
  if (repos.length === 0) return [] as MergedPRSummary[]

  const author = getGhUsername() || '@me'
  const repoFilter = repos.map((r) => `repo:${r}`).join(' ')
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

  try {
    const stdout = await ghExec(
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
    )

    if (!stdout) return [] as MergedPRSummary[]

    const json = JSON.parse(stdout) as {
      data?: {
        search?: {
          nodes?: Array<{
            number: number
            title: string
            url: string
            state: string
            headRefName: string
            repository?: { nameWithOwner: string }
          }>
        }
      }
    }

    const nodes = json.data?.search?.nodes ?? []
    return nodes
      .filter((n) => n.number && n.repository?.nameWithOwner)
      .map((n) => ({
        prNumber: n.number,
        prTitle: n.title,
        prUrl: n.url,
        branch: n.headRefName || '',
        repo: n.repository!.nameWithOwner,
        state: n.state === 'MERGED' ? ('MERGED' as const) : ('CLOSED' as const),
      }))
  } catch (err) {
    log.error({ err }, '[github] Failed to fetch closed PRs')
    return [] as MergedPRSummary[]
  }
}

export async function fetchInvolvedPRs(repos: string[], limit: number) {
  const ghUsername = getGhUsername()
  if (repos.length === 0 || !ghUsername) return [] as InvolvedPRSummary[]

  const seen = new Set<string>()
  const results: InvolvedPRSummary[] = []

  await Promise.all(
    repos.map(async (repoKey) => {
      try {
        const stdout = await ghExec(
          'gh',
          ['api', `repos/${repoKey}/pulls?state=open&per_page=100`],
          { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
        )
        if (!stdout) return

        const prs = JSON.parse(stdout) as Array<{
          number: number
          title: string
          html_url: string
          user?: { login?: string }
          requested_reviewers?: Array<{ login?: string }>
        }>

        for (const pr of prs) {
          if (pr.user?.login === ghUsername) continue
          const isReviewer = pr.requested_reviewers?.some(
            (r) => r.login === ghUsername,
          )
          if (!isReviewer) continue
          const key = `${repoKey}#${pr.number}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push({
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.html_url,
            repo: repoKey,
            author: pr.user?.login || 'unknown',
            involvement: 'review-requested',
          })
        }
      } catch (err) {
        log.error(
          { err, repo: repoKey },
          '[github] Failed to fetch involved PRs for repo',
        )
      }
    }),
  )

  try {
    const repoSet = new Set(repos)
    const stdout = await ghExec(
      'gh',
      [
        'api',
        `search/issues?q=type:pr+state:open+mentions:${ghUsername}+-author:${ghUsername}&per_page=${Math.min(limit, 100)}&sort=updated`,
      ],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
    )
    if (stdout) {
      const data = JSON.parse(stdout) as {
        items?: Array<{
          number: number
          title: string
          html_url: string
          user?: { login?: string }
          repository_url?: string
        }>
      }
      for (const item of data.items || []) {
        const repoMatch = item.repository_url?.match(/repos\/(.+)$/)
        const repo = repoMatch?.[1]
        if (!repo || !repoSet.has(repo)) continue

        const key = `${repo}#${item.number}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({
          prNumber: item.number,
          prTitle: item.title,
          prUrl: item.html_url,
          repo,
          author: item.user?.login || 'unknown',
          involvement: 'mentioned',
        })
      }
    }
  } catch (err) {
    log.error({ err }, '[github] Failed to search mentioned PRs')
  }

  return results.slice(0, limit)
}

export async function fetchPRComments(
  owner: string,
  repo: string,
  prNumber: number,
  limit: number,
  offset: number,
  excludeAuthors?: string[],
) {
  const [issueCommentsStdout, codeCommentsStdout] = await Promise.all([
    ghExec(
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
    ghExec(
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
  } catch (err) {
    log.error({ err }, '[github] Failed to parse issue comments response')
  }

  try {
    codeCommentsData = JSON.parse(codeCommentsStdout) || []
  } catch (err) {
    log.error({ err }, '[github] Failed to parse code comments response')
  }

  const excludeSet = excludeAuthors ? new Set(excludeAuthors) : null
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
