import { logCommand } from '@domains/logs/db'
import { execFileAsync, getExecStderr } from '@server/lib/exec'
import { emitPRChecks } from './checks/polling'
import { getLastFetchedPRs, invalidateChecksCache } from './checks/state'

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

export async function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method POST repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers -f reviewers[]=${reviewer}`
  try {
    const { stdout, stderr } = await execFileAsync(
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
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase',
) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method PUT repos/${owner}/${repo}/pulls/${prNumber}/merge -f merge_method=${method}`
  try {
    const { stdout, stderr } = await execFileAsync(
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
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function closePR(owner: string, repo: string, prNumber: number) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f state=closed`
  try {
    const { stdout, stderr } = await execFileAsync(
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
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function renamePR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
) {
  const prId = `${owner}/${repo}#${prNumber}`
  const cmd = `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f title=...`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        '--method',
        'PATCH',
        `repos/${owner}/${repo}/pulls/${prNumber}`,
        '-f',
        `title=${title}`,
      ],
      { timeout: 30000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    const existing = getLastFetchedPRs().find(
      (p) => p.repo === `${owner}/${repo}` && p.prNumber === prNumber,
    )
    if (existing) {
      existing.prTitle = title
    }
    emitPRChecks(getLastFetchedPRs())
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function editPR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string,
  draft?: boolean,
) {
  const prId = `${owner}/${repo}#${prNumber}`

  // Update title + body via REST API
  const patchCmd = `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f title=... -f body=...`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        '--method',
        'PATCH',
        `repos/${owner}/${repo}/pulls/${prNumber}`,
        '-f',
        `title=${title}`,
        '-f',
        `body=${body}`,
      ],
      { timeout: 30000 },
    )
    logCommand({ prId, category: 'github', command: patchCmd, stdout, stderr })
  } catch (err) {
    logAndThrow(err, patchCmd, prId)
  }

  // Draft status requires GraphQL mutations
  if (draft !== undefined) {
    if (draft) {
      const { stdout: nodeIdStdout } = await execFileAsync(
        'gh',
        ['api', `repos/${owner}/${repo}/pulls/${prNumber}`, '--jq', '.node_id'],
        { timeout: 15000 },
      )
      const nodeId = nodeIdStdout.trim()
      const mutation = `mutation { convertPullRequestToDraft(input: {pullRequestId: "${nodeId}"}) { pullRequest { isDraft } } }`
      try {
        const { stdout: gqlStdout, stderr: gqlStderr } = await execFileAsync(
          'gh',
          ['api', 'graphql', '-f', `query=${mutation}`],
          { timeout: 15000 },
        )
        logCommand({
          prId,
          category: 'github',
          command: 'gh api graphql convertPullRequestToDraft',
          stdout: gqlStdout,
          stderr: gqlStderr,
        })
      } catch (err) {
        logAndThrow(err, 'gh api graphql convertPullRequestToDraft', prId)
      }
    } else {
      const cmd = `gh pr ready ${prNumber} -R ${owner}/${repo}`
      try {
        const { stdout, stderr } = await execFileAsync(
          'gh',
          ['pr', 'ready', String(prNumber), '-R', `${owner}/${repo}`],
          { timeout: 15000 },
        )
        logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
      } catch (err) {
        logAndThrow(err, cmd, prId)
      }
    }
  }

  // Directly mutate cache and push to clients
  const existing = getLastFetchedPRs().find(
    (p) => p.repo === `${owner}/${repo}` && p.prNumber === prNumber,
  )
  if (existing) {
    existing.prTitle = title
    existing.prBody = body
    if (draft !== undefined) existing.isDraft = draft
  }
  emitPRChecks(getLastFetchedPRs())
}

export async function createPR(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
  draft: boolean,
) {
  const prId = `${owner}/${repo}`
  const cmd = `gh api --method POST repos/${owner}/${repo}/pulls -f head=... -f base=... -f title=... -f body=... -F draft=...`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${owner}/${repo}/pulls`,
        '-f',
        `head=${head}`,
        '-f',
        `base=${base}`,
        '-f',
        `title=${title}`,
        '-f',
        `body=${body}`,
        '-F',
        `draft=${draft}`,
      ],
      { timeout: 30000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    const data = JSON.parse(stdout)
    invalidateChecksCache()
    return data.number as number
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function rerunFailedCheck(
  owner: string,
  repo: string,
  checkUrl: string,
  prNumber?: number,
) {
  const runMatch = checkUrl.match(/actions\/runs\/(\d+)/)
  if (!runMatch) {
    throw new Error('Cannot rerun: unsupported check type')
  }
  const runId = runMatch[1]
  const prId = prNumber ? `${owner}/${repo}#${prNumber}` : undefined
  const cmd = `gh api --method POST repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
      ],
      { timeout: 30000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
  } catch (err) {
    logAndThrow(err, cmd, prId)
  }
}

export async function rerunAllFailedChecks(
  owner: string,
  repo: string,
  checkUrls: string[],
  prNumber?: number,
) {
  const runIds = new Set<string>()
  for (const url of checkUrls) {
    const match = url.match(/actions\/runs\/(\d+)/)
    if (match) {
      runIds.add(match[1])
    }
  }

  if (runIds.size === 0) {
    throw new Error('No valid action runs found')
  }

  const prId = prNumber ? `${owner}/${repo}#${prNumber}` : undefined
  const errors: string[] = []
  let successCount = 0

  await Promise.all(
    [...runIds].map(async (runId) => {
      const cmd = `gh api --method POST repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`
      try {
        const { stdout, stderr } = await execFileAsync(
          'gh',
          [
            'api',
            '--method',
            'POST',
            `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
          ],
          { timeout: 30000 },
        )
        logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
        successCount++
      } catch (err) {
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
        errors.push(stderr || message)
      }
    }),
  )

  invalidateChecksCache()

  if (successCount === 0) {
    throw new Error(errors[0] || 'All reruns failed')
  }

  return successCount
}
