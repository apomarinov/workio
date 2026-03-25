import type { PRCheckStatus } from '@domains/github/schema'
import { emitNotification } from '@domains/notifications/service'
import { getSettings } from '@domains/settings/db'
import type { HiddenGHAuthor, HiddenPR } from '@domains/settings/schema'
import {
  checkFailedOnCommit,
  getGhUsername,
  getInitialFullFetchDone,
  lastPRData,
  setInitialFullFetchDone,
} from './state'

export function isHiddenAuthor(
  hiddenAuthors: HiddenGHAuthor[] | undefined,
  repo: string,
  author: string,
) {
  if (!hiddenAuthors) return false
  return hiddenAuthors.some((h) => h.repo === repo && h.author === author)
}

export function isSilencedAuthor(
  silencedAuthors: HiddenGHAuthor[] | undefined,
  repo: string,
  author: string,
) {
  if (!silencedAuthors) return false
  return silencedAuthors.some((h) => h.repo === repo && h.author === author)
}

export function isHiddenPR(
  hiddenPRs: HiddenPR[] | undefined,
  repo: string,
  prNumber: number,
) {
  if (!hiddenPRs) return false
  return hiddenPRs.some((h) => h.repo === repo && h.prNumber === prNumber)
}

export async function processNewPRData(newPRs: PRCheckStatus[]) {
  if (!getInitialFullFetchDone()) {
    for (const pr of newPRs) {
      const key = `${pr.repo}#${pr.prNumber}`
      lastPRData.set(key, pr)
    }
    setInitialFullFetchDone(true)
    return
  }

  const settings = await getSettings()
  const hiddenAuthors = settings.hide_gh_authors
  const silencedAuthors = settings.silence_gh_authors
  const ghUsername = getGhUsername()

  for (const pr of newPRs) {
    const key = `${pr.repo}#${pr.prNumber}`
    const prev = lastPRData.get(key)

    // PR merged
    if (prev && prev.state !== 'MERGED' && pr.state === 'MERGED') {
      await emitNotification(
        'pr_merged',
        pr.repo,
        { prTitle: pr.prTitle, prUrl: pr.prUrl, prNumber: pr.prNumber },
        undefined,
        pr.prNumber,
      )
    }

    // PR closed (not merged)
    if (prev && prev.state !== 'CLOSED' && pr.state === 'CLOSED') {
      await emitNotification(
        'pr_closed',
        pr.repo,
        { prTitle: pr.prTitle, prUrl: pr.prUrl, prNumber: pr.prNumber },
        undefined,
        pr.prNumber,
      )
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
      await emitNotification(
        'check_failed',
        pr.repo,
        {
          prTitle: pr.prTitle,
          prUrl: pr.prUrl,
          prNumber: pr.prNumber,
          checkName: failedCheck?.name,
          checkUrl: failedCheck?.detailsUrl,
        },
        `${failedCheck?.detailsUrl || failedCheck?.name}:${pr.updatedAt}`,
        pr.prNumber,
      )
      if (pr.headCommitSha) {
        checkFailedOnCommit.set(key, pr.headCommitSha)
      }
    }

    // Clear check-failed tracking when commit changes
    if (
      prev &&
      pr.headCommitSha &&
      prev.headCommitSha &&
      prev.headCommitSha !== pr.headCommitSha
    ) {
      checkFailedOnCommit.delete(key)
    }

    // Checks passed — skip if retry of same commit
    if (prev && !prev.areAllChecksOk && pr.areAllChecksOk) {
      const failedSha = checkFailedOnCommit.get(key)
      if (!failedSha || failedSha !== pr.headCommitSha) {
        await emitNotification(
          'checks_passed',
          pr.repo,
          { prTitle: pr.prTitle, prUrl: pr.prUrl, prNumber: pr.prNumber },
          pr.updatedAt,
          pr.prNumber,
        )
      }
      checkFailedOnCommit.delete(key)
    }

    // Changes requested
    if (
      prev &&
      prev.reviewDecision !== 'CHANGES_REQUESTED' &&
      pr.reviewDecision === 'CHANGES_REQUESTED'
    ) {
      const changesReview = pr.reviews.find(
        (r) => r.state === 'CHANGES_REQUESTED',
      )
      const reviewer = changesReview?.author
      if (
        reviewer &&
        reviewer !== ghUsername &&
        !isHiddenAuthor(hiddenAuthors, pr.repo, reviewer) &&
        !isSilencedAuthor(silencedAuthors, pr.repo, reviewer)
      ) {
        await emitNotification(
          'changes_requested',
          pr.repo,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            prNumber: pr.prNumber,
            reviewer,
            reviewId: changesReview?.id,
          },
          `${reviewer}:${pr.updatedAt}`,
          pr.prNumber,
        )
      }
    }

    // Approved
    if (
      prev &&
      prev.reviewDecision !== 'APPROVED' &&
      pr.reviewDecision === 'APPROVED'
    ) {
      const approvedReview = pr.reviews.find((r) => r.state === 'APPROVED')
      const approver = approvedReview?.author
      if (
        approver &&
        approver !== ghUsername &&
        !isHiddenAuthor(hiddenAuthors, pr.repo, approver) &&
        !isSilencedAuthor(silencedAuthors, pr.repo, approver)
      ) {
        await emitNotification(
          'pr_approved',
          pr.repo,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            prNumber: pr.prNumber,
            approver,
            reviewId: approvedReview?.id,
          },
          `${approver}:${pr.updatedAt}`,
          pr.prNumber,
        )
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
        if (comment.id && prevCommentIds.has(comment.id)) continue
        await emitNotification(
          'new_comment',
          pr.repo,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            prNumber: pr.prNumber,
            author: comment.author,
            body: comment.body.substring(0, 200),
            commentUrl: comment.url,
            commentId: comment.id,
          },
          comment.id
            ? String(comment.id)
            : `${comment.author}:${comment.createdAt}`,
          pr.prNumber,
        )
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
        if (review.id && prevReviewIds.has(review.id)) continue
        if (!review.body) continue
        await emitNotification(
          'new_review',
          pr.repo,
          {
            prTitle: pr.prTitle,
            prUrl: pr.prUrl,
            prNumber: pr.prNumber,
            author: review.author,
            state: review.state,
            body: review.body?.substring(0, 200),
            reviewId: review.id,
          },
          review.id ? String(review.id) : `${review.author}:${review.state}`,
          pr.prNumber,
        )
      }
    }

    lastPRData.set(key, structuredClone(pr))
  }

  // Clean up removed PRs
  const currentKeys = new Set(newPRs.map((pr) => `${pr.repo}#${pr.prNumber}`))
  for (const key of lastPRData.keys()) {
    if (!currentKeys.has(key)) {
      lastPRData.delete(key)
      checkFailedOnCommit.delete(key)
    }
  }
}
