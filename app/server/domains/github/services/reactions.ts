import { logCommand } from '@domains/logs/db'
import { execFileAsync, getExecStderr } from '@server/lib/exec'
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
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}`,
        '--jq',
        '.node_id',
      ],
      { timeout: 15000 },
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
    const { stdout } = await execFileAsync(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`],
      { timeout: 15000 },
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

export async function addReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  // Reviews use GraphQL
  if (subjectType === 'review') {
    if (!prNumber) {
      throw new Error('prNumber is required for review reactions')
    }
    const nodeId = await getReviewNodeId(owner, repo, prNumber, subjectId)
    if (!nodeId) {
      throw new Error('Failed to get review node ID')
    }
    const cmd = `gh graphql addReaction(review=${subjectId}, content=${content})`
    try {
      await graphqlReaction(nodeId, content, false)
      logCommand({
        prId: `${owner}/${repo}`,
        category: 'github',
        command: cmd,
        stdout: 'ok',
      })
      invalidateChecksCache()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logCommand({
        prId: `${owner}/${repo}`,
        category: 'github',
        command: cmd,
        stderr: message,
        failed: true,
      })
      throw err
    }
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

  const cmd = `gh api --method POST ${endpoint} -f content=${content}`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['api', '--method', 'POST', endpoint, '-f', `content=${content}`],
      { timeout: 15000 },
    )
    logCommand({
      prId: `${owner}/${repo}`,
      category: 'github',
      command: cmd,
      stdout,
      stderr,
    })
    invalidateChecksCache()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stderr = getExecStderr(err)
    logCommand({
      prId: `${owner}/${repo}`,
      category: 'github',
      command: cmd,
      stdout: '',
      stderr: stderr || message,
      failed: true,
    })
    throw new Error(stderr || message)
  }
}

export async function removeReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  // Reviews use GraphQL
  if (subjectType === 'review') {
    if (!prNumber) {
      throw new Error('prNumber is required for review reactions')
    }
    const nodeId = await getReviewNodeId(owner, repo, prNumber, subjectId)
    if (!nodeId) {
      throw new Error('Failed to get review node ID')
    }
    const cmd = `gh graphql removeReaction(review=${subjectId}, content=${content})`
    try {
      await graphqlReaction(nodeId, content, true)
      logCommand({
        prId: `${owner}/${repo}`,
        category: 'github',
        command: cmd,
        stdout: 'ok',
      })
      invalidateChecksCache()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logCommand({
        prId: `${owner}/${repo}`,
        category: 'github',
        command: cmd,
        stderr: message,
        failed: true,
      })
      throw err
    }
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
  const prId = `${owner}/${repo}`
  const cmd = `gh api --method DELETE ${deleteEndpoint}`
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['api', '--method', 'DELETE', deleteEndpoint],
      { timeout: 15000 },
    )
    logCommand({ prId, category: 'github', command: cmd, stdout, stderr })
    invalidateChecksCache()
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
    throw new Error(stderr || message)
  }
}
