import { logCommand } from '@domains/logs/db'
import { execFileAsyncLogged, getExecStderr } from '@server/lib/exec'
import { ghExec } from './checks/fetcher'
import { getGhUsername, invalidateChecksCache } from './checks/state'

const REACTION_CONTENT_TO_GRAPHQL: Record<string, string> = {
  '+1': 'THUMBS_UP',
  '-1': 'THUMBS_DOWN',
  laugh: 'LAUGH',
  hooray: 'HOORAY',
  confused: 'CONFUSED',
  heart: 'HEART',
  rocket: 'ROCKET',
  eyes: 'EYES',
}

async function getReviewNodeId(
  owner: string,
  repo: string,
  prNumber: number,
  reviewId: number,
) {
  try {
    const { stdout } = await execFileAsyncLogged(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}`,
        '--jq',
        '.node_id',
      ],
      { timeout: 15000, category: 'github', errorOnly: true },
    )
    if (!stdout.trim()) return null
    return stdout.trim()
  } catch {
    return null
  }
}

async function graphqlReaction(
  nodeId: string,
  content: string,
  remove: boolean,
) {
  const gqlContent = REACTION_CONTENT_TO_GRAPHQL[content] || content
  const mutation = remove ? 'removeReaction' : 'addReaction'
  const query = `mutation { ${mutation}(input: { subjectId: "${nodeId}", content: ${gqlContent} }) { reaction { content } } }`
  try {
    const { stdout } = await execFileAsyncLogged(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`],
      { timeout: 15000, category: 'github', errorOnly: true },
    )
    const result = JSON.parse(stdout)
    if (result.errors?.length) {
      throw new Error(
        result.errors.map((e: { message: string }) => e.message).join(', '),
      )
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes('Unexpected token')) {
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    const stderr = getExecStderr(err)
    throw new Error(stderr || message)
  }
}

/** Run a GraphQL reaction mutation and log the result. */
async function graphqlReactionLogged(
  nodeId: string,
  content: string,
  remove: boolean,
  logOpts: { prId: string; cmd: string },
) {
  try {
    await graphqlReaction(nodeId, content, remove)
    logCommand({
      prId: logOpts.prId,
      category: 'github',
      service: 'github-graphql',
      command: logOpts.cmd,
      stdout: 'ok',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logCommand({
      prId: logOpts.prId,
      category: 'github',
      service: 'github-graphql',
      command: logOpts.cmd,
      stderr: message,
      failed: true,
    })
    throw err
  }
}

export async function addReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  const prId = `${owner}/${repo}`

  // Reviews use GraphQL
  if (subjectType === 'review') {
    if (!prNumber) {
      throw new Error('prNumber is required for review reactions')
    }
    const nodeId = await getReviewNodeId(owner, repo, prNumber, subjectId)
    if (!nodeId) {
      throw new Error('Failed to get review node ID')
    }
    await graphqlReactionLogged(nodeId, content, false, {
      prId,
      cmd: `gh graphql addReaction(review=${subjectId}, content=${content})`,
    })
    invalidateChecksCache()
    return
  }

  let endpoint: string
  switch (subjectType) {
    case 'issue_comment':
      endpoint = `repos/${owner}/${repo}/issues/comments/${subjectId}/reactions`
      break
    case 'review_comment':
      endpoint = `repos/${owner}/${repo}/pulls/comments/${subjectId}/reactions`
      break
  }

  await execFileAsyncLogged(
    'gh',
    ['api', '--method', 'POST', endpoint, '-f', `content=${content}`],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api --method POST ${endpoint} -f content=${content}`,
      prId,
    },
  )
  invalidateChecksCache()
}

export async function removeReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  const prId = `${owner}/${repo}`

  // Reviews use GraphQL
  if (subjectType === 'review') {
    if (!prNumber) {
      throw new Error('prNumber is required for review reactions')
    }
    const nodeId = await getReviewNodeId(owner, repo, prNumber, subjectId)
    if (!nodeId) {
      throw new Error('Failed to get review node ID')
    }
    await graphqlReactionLogged(nodeId, content, true, {
      prId,
      cmd: `gh graphql removeReaction(review=${subjectId}, content=${content})`,
    })
    invalidateChecksCache()
    return
  }

  let listEndpoint: string
  switch (subjectType) {
    case 'issue_comment':
      listEndpoint = `repos/${owner}/${repo}/issues/comments/${subjectId}/reactions`
      break
    case 'review_comment':
      listEndpoint = `repos/${owner}/${repo}/pulls/comments/${subjectId}/reactions`
      break
  }

  // List reactions and find ours
  const listStdout = await ghExec(
    'gh',
    ['api', `${listEndpoint}?content=${content}&per_page=100`],
    { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
  )
  if (!listStdout) {
    throw new Error('Failed to list reactions')
  }

  let reactions: { id: number; user: { login: string }; content: string }[]
  try {
    reactions = JSON.parse(listStdout)
  } catch {
    throw new Error('Failed to parse reactions')
  }

  const ghUsername = getGhUsername()
  const myReaction = reactions.find(
    (r) => r.user.login === ghUsername && r.content === content,
  )
  if (!myReaction) {
    throw new Error('Reaction not found')
  }

  const deleteEndpoint = `${listEndpoint}/${myReaction.id}`
  await execFileAsyncLogged(
    'gh',
    ['api', '--method', 'DELETE', deleteEndpoint],
    {
      timeout: 15000,
      category: 'github',
      logCmd: `gh api --method DELETE ${deleteEndpoint}`,
      prId,
    },
  )
  invalidateChecksCache()
}
