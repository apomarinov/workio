import { execFileAsyncLogged } from '@server/lib/exec'
import { invalidateChecksCache } from './checks/state'

export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
) {
  await execFileAsyncLogged(
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
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh pr comment ${prNumber} --repo ${owner}/${repo} -b "..."`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  invalidateChecksCache()
}

export async function replyToReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
      '-f',
      `body=${body}`,
    ],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies -f body="..."`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  invalidateChecksCache()
}

export async function editIssueComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      `repos/${owner}/${repo}/issues/comments/${commentId}`,
      '-X',
      'PATCH',
      '-f',
      `body=${body}`,
    ],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api repos/${owner}/${repo}/issues/comments/${commentId} -X PATCH -f body="..."`,
      prId: `${owner}/${repo}`,
    },
  )
  invalidateChecksCache()
}

export async function editReviewComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      `repos/${owner}/${repo}/pulls/comments/${commentId}`,
      '-X',
      'PATCH',
      '-f',
      `body=${body}`,
    ],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api repos/${owner}/${repo}/pulls/comments/${commentId} -X PATCH -f body="..."`,
      prId: `${owner}/${repo}`,
    },
  )
  invalidateChecksCache()
}

export async function editReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewId: number,
  body: string,
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      `repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}`,
      '-X',
      'PUT',
      '-f',
      `body=${body}`,
    ],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId} -X PUT -f body="..."`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  invalidateChecksCache()
}
