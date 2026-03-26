import { execFileAsyncLogged } from '@server/lib/exec'
import { emitPRChecks } from './checks/polling'
import { getLastFetchedPRs, invalidateChecksCache } from './checks/state'

export async function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      '-f',
      `reviewers[]=${reviewer}`,
    ],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api --method POST repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers -f reviewers[]=${reviewer}`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  invalidateChecksCache()
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase',
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      '--method',
      'PUT',
      `repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      '-f',
      `merge_method=${method}`,
    ],
    {
      timeout: 30000,
      category: 'github',
      logCmd: `gh api --method PUT repos/${owner}/${repo}/pulls/${prNumber}/merge -f merge_method=${method}`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  invalidateChecksCache()
}

export async function closePR(owner: string, repo: string, prNumber: number) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      '--method',
      'PATCH',
      `repos/${owner}/${repo}/pulls/${prNumber}`,
      '-f',
      'state=closed',
    ],
    {
      timeout: 30000,
      category: 'github',
      logCmd: `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f state=closed`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  invalidateChecksCache()
}

export async function renamePR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
) {
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      '--method',
      'PATCH',
      `repos/${owner}/${repo}/pulls/${prNumber}`,
      '-f',
      `title=${title}`,
    ],
    {
      timeout: 30000,
      category: 'github',
      logCmd: `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f title=...`,
      prId: `${owner}/${repo}#${prNumber}`,
    },
  )
  const existing = getLastFetchedPRs().find(
    (p) => p.repo === `${owner}/${repo}` && p.prNumber === prNumber,
  )
  if (existing) {
    existing.prTitle = title
  }
  emitPRChecks(getLastFetchedPRs())
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
  await execFileAsyncLogged(
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
    {
      timeout: 30000,
      category: 'github',
      logCmd: `gh api --method PATCH repos/${owner}/${repo}/pulls/${prNumber} -f title=... -f body=...`,
      prId,
    },
  )

  // Draft status requires GraphQL mutations
  if (draft !== undefined) {
    if (draft) {
      const { stdout: nodeIdStdout } = await execFileAsyncLogged(
        'gh',
        ['api', `repos/${owner}/${repo}/pulls/${prNumber}`, '--jq', '.node_id'],
        {
          timeout: 15000,
          category: 'github',
          logCmd: `gh api repos/${owner}/${repo}/pulls/${prNumber} --jq .node_id`,
          prId,
        },
      )
      const nodeId = nodeIdStdout.trim()
      const mutation = `mutation { convertPullRequestToDraft(input: {pullRequestId: "${nodeId}"}) { pullRequest { isDraft } } }`
      await execFileAsyncLogged(
        'gh',
        ['api', 'graphql', '-f', `query=${mutation}`],
        {
          timeout: 15000,
          category: 'github',
          logCmd: 'gh api graphql convertPullRequestToDraft',
          prId,
        },
      )
    } else {
      await execFileAsyncLogged(
        'gh',
        ['pr', 'ready', String(prNumber), '-R', `${owner}/${repo}`],
        {
          timeout: 15000,
          category: 'github',
          logCmd: `gh pr ready ${prNumber} -R ${owner}/${repo}`,
          prId,
        },
      )
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
  const { stdout } = await execFileAsyncLogged(
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
    {
      timeout: 30000,
      category: 'github',
      logCmd: `gh api --method POST repos/${owner}/${repo}/pulls -f head=... -f base=... -f title=... -f body=... -F draft=...`,
      prId: `${owner}/${repo}`,
    },
  )
  const data = JSON.parse(stdout)
  invalidateChecksCache()
  return data.number as number
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
  await execFileAsyncLogged(
    'gh',
    [
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
    ],
    {
      timeout: 30000,
      category: 'github',
      logCmd: `gh api --method POST repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
      prId: prNumber ? `${owner}/${repo}#${prNumber}` : undefined,
    },
  )
  invalidateChecksCache()
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
      try {
        await execFileAsyncLogged(
          'gh',
          [
            'api',
            '--method',
            'POST',
            `repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
          ],
          {
            timeout: 30000,
            category: 'github',
            logCmd: `gh api --method POST repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
            prId,
          },
        )
        successCount++
      } catch (err) {
        // Already logged by execFileAsyncLogged
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }),
  )

  invalidateChecksCache()

  if (successCount === 0) {
    throw new Error(errors[0] || 'All reruns failed')
  }

  return successCount
}
