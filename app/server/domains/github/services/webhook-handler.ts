import { emitNotification } from '@domains/notifications/service'
import { getIO } from '@server/io'
import { log } from '@server/logger'
import type {
  PRCheckStatus,
  PRComment,
  PRReview,
  PRReviewThread,
  WebhookPayload,
} from '../schema'
import { sortDiscussion } from './checks/fetcher'
import { processNewPRData } from './checks/notifications'
import { emitPRChecks, refreshPRChecks } from './checks/polling'
import {
  getGhUsername,
  getLastFetchedPRs,
  invalidateChecksCache,
  setLastFetchedPRs,
  WEBHOOK_THROTTLE_MS,
  webhookQueue,
} from './checks/state'

// --- Optimistic patching ---

function findPR(repo: string, prNumber: number) {
  return getLastFetchedPRs().find(
    (pr) => pr.repo === repo && pr.prNumber === prNumber,
  )
}

function patchPullRequest(repo: string, payload: WebhookPayload) {
  const prData = payload.pull_request
  if (!prData) return false

  const existing = findPR(repo, prData.number)

  if (payload.action === 'opened') {
    if (existing) return false
    const newPR: PRCheckStatus = {
      prNumber: prData.number,
      prTitle: prData.title,
      prUrl: prData.html_url,
      prBody: prData.body || '',
      branch: prData.head?.ref || '',
      baseBranch: prData.base?.ref || '',
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
      isDraft: prData.draft ?? false,
    }
    setLastFetchedPRs([...getLastFetchedPRs(), newPR])
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
    if (prData.draft !== undefined) existing.isDraft = prData.draft

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

function patchPullRequestReview(repo: string, payload: WebhookPayload) {
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

  const idx = existing.reviews.findIndex((r) => r.author === review.user.login)
  if (idx >= 0) {
    existing.reviews[idx] = newReview
  } else {
    existing.reviews.push(newReview)
  }

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

function patchIssueComment(repo: string, payload: WebhookPayload) {
  if (payload.action !== 'created') return false
  const comment = payload.comment
  const issueNumber = payload.issue?.number
  if (!comment || !issueNumber || !payload.issue?.pull_request) return false

  const existing = findPR(repo, issueNumber)
  if (!existing) return false

  if (comment.user.login.includes('[bot]')) return false

  const newComment: PRComment = {
    id: comment.id,
    url: comment.html_url,
    author: comment.user.login,
    avatarUrl: `https://github.com/${comment.user.login}.png?size=32`,
    body: comment.body,
    createdAt: comment.created_at,
  }

  existing.comments = [newComment, ...existing.comments]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 50)

  existing.discussion.push({ type: 'comment', comment: newComment })
  sortDiscussion(existing.discussion)

  return true
}

function patchReviewComment(repo: string, payload: WebhookPayload) {
  if (payload.action !== 'created') return false
  const comment = payload.comment
  const prNumber = payload.pull_request?.number
  if (!comment || !prNumber) return false

  const existing = findPR(repo, prNumber)
  if (!existing) return false

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

  const existingIdx = existing.comments.findIndex(
    (c) => c.id && c.id === comment.id,
  )
  if (existingIdx >= 0) return false

  existing.comments = [newComment, ...existing.comments]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 50)

  const reviewId = comment.pull_request_review_id
  const inReplyToId = comment.in_reply_to_id
  let placed = false

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

  if (!placed && reviewId) {
    const reviewItem = existing.discussion.find(
      (d) => d.type === 'review' && d.review.id === reviewId,
    )
    if (reviewItem && reviewItem.type === 'review') {
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

  if (!placed) {
    existing.discussion.push({
      type: 'thread',
      thread: { path: comment.path || '', comments: [newComment] },
    })
    sortDiscussion(existing.discussion)
  }

  return true
}

function tryApplyWebhookPatch(event: string, payload: WebhookPayload) {
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

// --- Public API ---

export function queueWebhookRefresh(repo: string) {
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

export async function handleInvolvedPRWebhook(
  event: string,
  payload: WebhookPayload,
) {
  const ghUsername = getGhUsername()
  if (!ghUsername) return
  const repo = payload.repository?.full_name
  if (!repo) return

  const prData = payload.pull_request

  // Review requested
  if (
    event === 'pull_request' &&
    payload.action === 'review_requested' &&
    payload.requested_reviewer?.login === ghUsername
  ) {
    const author = prData?.user?.login || 'unknown'
    await emitNotification(
      'review_requested',
      repo,
      {
        prTitle: prData?.title || '',
        prUrl: prData?.html_url || '',
        prNumber: prData?.number,
        author,
      },
      undefined,
      prData?.number,
    )
    return
  }

  // Mentioned in a comment
  if (event === 'issue_comment' || event === 'pull_request_review_comment') {
    const comment = payload.comment
    if (comment?.body?.includes(`@${ghUsername}`)) {
      const prNumber = prData?.number || payload.issue?.number
      const prTitle = prData?.title || ''
      const prUrl = prData?.html_url || ''
      const author = comment.user?.login || 'unknown'
      await emitNotification(
        'pr_mentioned',
        repo,
        {
          prTitle,
          prUrl,
          prNumber,
          author,
          body: comment.body?.substring(0, 200),
          commentUrl: comment.html_url,
          commentId: comment.id,
        },
        comment.id ? String(comment.id) : undefined,
        prNumber,
      )
    }
  }
}

export async function applyWebhookAndRefresh(
  event: string,
  payload: WebhookPayload,
) {
  const repo = payload.repository?.full_name
  if (!repo) return

  const patched = tryApplyWebhookPatch(event, payload)

  if (patched) {
    await processNewPRData(getLastFetchedPRs())
    await emitPRChecks(getLastFetchedPRs())
    log.info(`[webhooks] Applied optimistic patch for ${event} on ${repo}`)
  }

  queueWebhookRefresh(repo)
}

/** Process an incoming GitHub webhook HTTP request. Called from the Fastify route. */
export function handleWebhookRequest(event: string, payload: WebhookPayload) {
  const repo = payload.repository?.full_name

  // Handle ping event
  if (event === 'ping' && repo) {
    log.info(`[webhooks] Received ping for ${repo}`)
    getIO()?.emit('webhook:ping', { repo })
    return
  }

  if (!repo) return

  const prAuthor =
    payload.pull_request?.user?.login ||
    (payload as { issue?: { user?: { login?: string } } }).issue?.user?.login
  const currentUser = getGhUsername()

  if (
    event === 'check_suite' ||
    !prAuthor ||
    !currentUser ||
    prAuthor === currentUser
  ) {
    log.info(`[webhooks] Received ${event} event for ${repo}`)
    applyWebhookAndRefresh(event, payload)
  } else {
    log.info(
      `[webhooks] Received ${event} event for ${repo} (author: ${prAuthor}, checking involvement)`,
    )
    handleInvolvedPRWebhook(event, payload)
  }
}
