import { logCommand } from '@domains/logs/db'
import { execFileAsync, getExecStderr } from '@server/lib/exec'
import { invalidateChecksCache } from './checks/state'

function logAndThrow(err: unknown, cmd: string, prId?: string): never {
  const message = err instanceof Error ? err.message : String(err)
  const stderr = getExecStderr(err)
  logCommand({
    prId,
    category: 'github',
    command: cmd,
    stdout: '',
    stderr: stderr || message,
    failed: true,
  })
  throw new Error(stderr || message)
}

export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh pr comment ${prNumber} --repo ${owner}/${repo} -b "..."`
  try {
    const { stdout, stderr } = await execFileAsync(
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
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function replyToReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies -f body="..."`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
        '-f',
        `body=${body}`,
      ],
      { timeout: 15000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function editIssueComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
) {
  const prId = `${owner}/${repo}`
  const cmd = `gh api repos/${owner}/${repo}/issues/comments/${commentId} -X PATCH -f body="..."`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/issues/comments/${commentId}`,
        '-X',
        'PATCH',
        '-f',
        `body=${body}`,
      ],
      { timeout: 15000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function editReviewComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
) {
  const prId = `${owner}/${repo}`
  const cmd = `gh api repos/${owner}/${repo}/pulls/comments/${commentId} -X PATCH -f body="..."`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/comments/${commentId}`,
        '-X',
        'PATCH',
        '-f',
        `body=${body}`,
      ],
      { timeout: 15000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function editReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewId: number,
  body: string,
) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId} -X PUT -f body="..."`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}`,
        '-X',
        'PUT',
        '-f',
        `body=${body}`,
      ],
      { timeout: 15000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}
