import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'
import {
  addPRComment,
  addReaction,
  applyWebhookAndRefresh,
  closePR,
  createPR,
  editIssueComment,
  editPR,
  editReview,
  editReviewComment,
  fetchAllClosedPRs,
  fetchInvolvedPRs,
  getGhUsername,
  handleInvolvedPRWebhook,
  mergePR,
  refreshPRChecks,
  removeReaction,
  renamePR,
  replyToReviewComment,
  requestPRReview,
  rerunAllFailedChecks,
  rerunFailedCheck,
} from '../github/checks'
import {
  createRepoWebhook,
  deleteRepoWebhook,
  getOrCreateWebhookSecret,
  recreateRepoWebhook,
  testWebhook,
  verifyWebhookSignature,
} from '../github/webhooks'
import { getIO } from '../io'
import { log } from '../logger'

const exec = promisify(execFile)

export default async function githubRoutes(fastify: FastifyInstance) {
  // GitHub repos (for repo picker)
  fastify.get<{
    Querystring: { q?: string }
  }>('/api/github/repos', async (request) => {
    const query = request.query.q?.trim().toLowerCase() || ''

    try {
      const { stdout } = await exec(
        'gh',
        [
          'api',
          '--method',
          'GET',
          '/user/repos',
          '-f',
          'affiliation=owner,collaborator,organization_member',
          '-f',
          'sort=pushed',
          '-f',
          'direction=desc',
          '-f',
          `per_page=${query ? 100 : 15}`,
          '--jq',
          '.[].full_name',
        ],
        { timeout: 15000 },
      )

      let repos = stdout.trim().split('\n').filter(Boolean)
      if (query) {
        repos = repos.filter((r) => r.toLowerCase().includes(query))
      }
      return { repos }
    } catch (err) {
      log.error({ err }, '[github] Failed to fetch repos')
      return { repos: [] }
    }
  })

  // Check if a repo has conductor.json
  fastify.get<{
    Querystring: { repo?: string }
  }>('/api/github/conductor', async (request) => {
    const repo = request.query.repo?.trim()
    if (!repo || !repo.includes('/')) {
      return { hasConductor: false }
    }

    try {
      await exec(
        'gh',
        ['api', `repos/${repo}/contents/conductor.json`, '--jq', '.name'],
        { timeout: 10000 },
      )
      return { hasConductor: true }
    } catch (err) {
      log.error({ err }, '[github] Failed to check conductor.json')
      return { hasConductor: false }
    }
  })

  // Merged/closed PRs by @me across all repos (single GraphQL call)
  fastify.get<{
    Querystring: { repos?: string; limit?: string }
  }>('/api/github/closed-prs', async (request) => {
    const repos = (request.query.repos || '').split(',').filter(Boolean)
    const limit = Math.min(Number(request.query.limit) || 20, 100)
    return { prs: await fetchAllClosedPRs(repos, limit) }
  })

  // Involved PRs (review-requested or mentioned) across all repos
  fastify.get<{
    Querystring: { repos?: string; limit?: string }
  }>('/api/github/involved-prs', async (request) => {
    const repos = (request.query.repos || '').split(',').filter(Boolean)
    const limit = Math.min(Number(request.query.limit) || 30, 100)
    return { prs: await fetchInvolvedPRs(repos, limit) }
  })

  // Re-request PR review
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { reviewer: string }
  }>(
    '/api/github/:owner/:repo/pr/:pr/request-review',
    async (request, reply) => {
      const { owner, repo, pr } = request.params
      const { reviewer } = request.body
      if (!reviewer) {
        return reply.status(400).send({ error: 'reviewer is required' })
      }
      const result = await requestPRReview(owner, repo, Number(pr), reviewer)
      if (!result.ok) {
        return reply.status(500).send({ error: result.error })
      }
      await refreshPRChecks(true, {
        repo: `${owner}/${repo}`,
        prNumber: Number(pr),
        until: (pr) =>
          pr?.reviews?.some(
            (r) => r.author === reviewer && r.state === 'PENDING',
          ) ?? false,
      })
      return { ok: true }
    },
  )

  // Merge PR
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { method?: 'merge' | 'squash' | 'rebase' }
  }>('/api/github/:owner/:repo/pr/:pr/merge', async (request, reply) => {
    const { owner, repo, pr } = request.params
    const method = request.body?.method || 'squash'
    const result = await mergePR(owner, repo, Number(pr), method)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    await refreshPRChecks(true, {
      repo: `${owner}/${repo}`,
      prNumber: Number(pr),
      until: (pr) => !pr || pr.state === 'MERGED',
    })
    return { ok: true }
  })

  // Close PR
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
  }>('/api/github/:owner/:repo/pr/:pr/close', async (request, reply) => {
    const { owner, repo, pr } = request.params
    const result = await closePR(owner, repo, Number(pr))
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    await refreshPRChecks(true, {
      repo: `${owner}/${repo}`,
      prNumber: Number(pr),
      until: (pr) => !pr || pr.state === 'CLOSED',
    })
    return { ok: true }
  })

  // Rename PR
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { title: string }
  }>('/api/github/:owner/:repo/pr/:pr/rename', async (request, reply) => {
    const { owner, repo, pr } = request.params
    const { title } = request.body
    if (!title) {
      return reply.status(400).send({ error: 'title is required' })
    }
    const result = await renamePR(owner, repo, Number(pr), title)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    return { ok: true }
  })

  // Edit PR (title + body + draft)
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { title: string; body: string; draft?: boolean }
  }>('/api/github/:owner/:repo/pr/:pr/edit', async (request, reply) => {
    const { owner, repo, pr } = request.params
    const { title, body, draft } = request.body
    if (!title) {
      return reply.status(400).send({ error: 'title is required' })
    }
    const result = await editPR(
      owner,
      repo,
      Number(pr),
      title,
      body ?? '',
      draft,
    )
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    return { ok: true }
  })

  // Create PR
  fastify.post<{
    Params: { owner: string; repo: string }
    Body: {
      head: string
      base: string
      title: string
      body: string
      draft: boolean
    }
  }>('/api/github/:owner/:repo/pr/create', async (request, reply) => {
    const { owner, repo } = request.params
    const { head, base, title, body, draft } = request.body
    if (!head || !base || !title) {
      return reply
        .status(400)
        .send({ error: 'head, base, and title are required' })
    }
    const result = await createPR(
      owner,
      repo,
      head,
      base,
      title,
      body ?? '',
      draft ?? false,
    )
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    await refreshPRChecks(true, {
      repo: `${owner}/${repo}`,
      prNumber: result.prNumber!,
      until: (pr) => !!pr,
    })
    return { ok: true, prNumber: result.prNumber }
  })

  // Add PR comment
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { body: string }
  }>('/api/github/:owner/:repo/pr/:pr/comment', async (request, reply) => {
    const { owner, repo, pr } = request.params
    const { body } = request.body
    if (!body) {
      return reply.status(400).send({ error: 'body is required' })
    }
    const result = await addPRComment(owner, repo, Number(pr), body)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    await refreshPRChecks(true)
    return { ok: true }
  })

  // Reply to a review comment thread
  fastify.post<{
    Params: { owner: string; repo: string; pr: string; commentId: string }
    Body: { body: string }
  }>(
    '/api/github/:owner/:repo/pr/:pr/reply/:commentId',
    async (request, reply) => {
      const { owner, repo, pr, commentId } = request.params
      const { body } = request.body
      if (!body) {
        return reply.status(400).send({ error: 'body is required' })
      }
      const result = await replyToReviewComment(
        owner,
        repo,
        Number(pr),
        Number(commentId),
        body,
      )
      if (!result.ok) {
        return reply.status(500).send({ error: result.error })
      }
      await refreshPRChecks(true)
      return { ok: true }
    },
  )

  // Edit a comment or review
  fastify.patch<{
    Params: { owner: string; repo: string; pr: string; commentId: string }
    Body: { body: string; type: 'issue_comment' | 'review_comment' | 'review' }
  }>(
    '/api/github/:owner/:repo/pr/:pr/comment/:commentId',
    async (request, reply) => {
      const { owner, repo, pr, commentId } = request.params
      const { body, type } = request.body
      if (!body) {
        return reply.status(400).send({ error: 'body is required' })
      }
      if (!type) {
        return reply.status(400).send({ error: 'type is required' })
      }
      let result: { ok: boolean; error?: string }
      switch (type) {
        case 'issue_comment':
          result = await editIssueComment(owner, repo, Number(commentId), body)
          break
        case 'review_comment':
          result = await editReviewComment(owner, repo, Number(commentId), body)
          break
        case 'review':
          result = await editReview(
            owner,
            repo,
            Number(pr),
            Number(commentId),
            body,
          )
          break
        default:
          return reply.status(400).send({ error: 'Invalid type' })
      }
      if (!result.ok) {
        return reply.status(500).send({ error: result.error })
      }
      await refreshPRChecks(true)
      return { ok: true }
    },
  )

  // Add reaction to a comment or review
  fastify.post<{
    Params: { owner: string; repo: string }
    Body: {
      subjectId: number
      subjectType: 'issue_comment' | 'review_comment' | 'review'
      content: string
      prNumber?: number
    }
  }>('/api/github/:owner/:repo/reaction', async (request, reply) => {
    const { owner, repo } = request.params
    const { subjectId, subjectType, content, prNumber } = request.body
    if (!subjectId || !subjectType || !content) {
      return reply
        .status(400)
        .send({ error: 'subjectId, subjectType, and content are required' })
    }
    const result = await addReaction(
      owner,
      repo,
      subjectId,
      subjectType,
      content,
      prNumber,
    )
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    refreshPRChecks(true)
    return { ok: true }
  })

  // Remove reaction from a comment or review
  fastify.delete<{
    Params: { owner: string; repo: string }
    Body: {
      subjectId: number
      subjectType: 'issue_comment' | 'review_comment' | 'review'
      content: string
      prNumber?: number
    }
  }>('/api/github/:owner/:repo/reaction', async (request, reply) => {
    const { owner, repo } = request.params
    const { subjectId, subjectType, content, prNumber } = request.body
    if (!subjectId || !subjectType || !content) {
      return reply
        .status(400)
        .send({ error: 'subjectId, subjectType, and content are required' })
    }
    const result = await removeReaction(
      owner,
      repo,
      subjectId,
      subjectType,
      content,
      prNumber,
    )
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    refreshPRChecks(true)
    return { ok: true }
  })

  // Re-run failed check
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { checkUrl: string }
  }>('/api/github/:owner/:repo/pr/:pr/rerun-check', async (request, reply) => {
    const { owner, repo } = request.params
    const { checkUrl } = request.body
    if (!checkUrl) {
      return reply.status(400).send({ error: 'checkUrl is required' })
    }
    const result = await rerunFailedCheck(owner, repo, checkUrl)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    await refreshPRChecks(true, {
      repo: `${owner}/${repo}`,
      prNumber: Number(request.params.pr),
      // Poll until any check is queued/in_progress - the re-run creates a new
      // run ID so we can't match by the original detailsUrl
      until: (pr) => {
        if (!pr) return false
        return pr.checks.some(
          (c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS',
        )
      },
    })
    return { ok: true }
  })

  // Re-run all failed checks
  fastify.post<{
    Params: { owner: string; repo: string; pr: string }
    Body: { checkUrls: string[] }
  }>(
    '/api/github/:owner/:repo/pr/:pr/rerun-all-checks',
    async (request, reply) => {
      const { owner, repo } = request.params
      const { checkUrls } = request.body
      if (!checkUrls || !Array.isArray(checkUrls) || checkUrls.length === 0) {
        return reply.status(400).send({ error: 'checkUrls array is required' })
      }
      const result = await rerunAllFailedChecks(owner, repo, checkUrls)
      if (!result.ok) {
        return reply.status(500).send({ error: result.error })
      }
      await refreshPRChecks(true, {
        repo: `${owner}/${repo}`,
        prNumber: Number(request.params.pr),
        until: (pr) => {
          if (!pr) return false
          // Consider done when at least one check is now queued/in_progress
          return pr.checks.some(
            (c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS',
          )
        },
      })
      return { ok: true, rerunCount: result.rerunCount }
    },
  )

  // GitHub Webhook endpoint
  fastify.post<{
    Body: unknown
    Headers: { 'x-hub-signature-256'?: string; 'x-github-event'?: string }
  }>(
    '/api/webhooks/github',
    {
      config: {
        rateLimit: { max: 100, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const signature = request.headers['x-hub-signature-256']
      const event = request.headers['x-github-event']

      if (!signature) {
        return reply.status(401).send({ error: 'Missing signature' })
      }

      const secret = await getOrCreateWebhookSecret()
      const payload =
        typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body)

      if (!verifyWebhookSignature(payload, signature, secret)) {
        return reply.status(401).send({ error: 'Invalid signature' })
      }

      // Extract repo and PR author from payload
      const body = request.body as {
        repository?: { full_name?: string }
        pull_request?: { user?: { login?: string } }
        issue?: { user?: { login?: string } }
      }
      const repo = body?.repository?.full_name

      // Handle ping event (webhook test)
      if (event === 'ping' && repo) {
        log.info(`[webhooks] Received ping for ${repo}`)
        getIO()?.emit('webhook:ping', { repo })
        return { ok: true }
      }

      if (repo && event) {
        // Extract PR author based on event type
        // - pull_request, pull_request_review, pull_request_review_comment: pull_request.user.login
        // - issue_comment (on PRs): issue.user.login
        // - check_suite: let all through (CI status is important for our PRs)
        const prAuthor =
          body?.pull_request?.user?.login || body?.issue?.user?.login
        const currentUser = getGhUsername()

        // Process if it's our PR or we can't determine the author
        if (
          event === 'check_suite' ||
          !prAuthor ||
          !currentUser ||
          prAuthor === currentUser
        ) {
          log.info(`[webhooks] Received ${event} event for ${repo}`)
          applyWebhookAndRefresh(event, request.body as Record<string, unknown>)
        } else {
          // Not our PR - check if we're involved (review requested / mentioned)
          log.info(
            `[webhooks] Received ${event} event for ${repo} (author: ${prAuthor}, checking involvement)`,
          )
          handleInvolvedPRWebhook(
            event,
            request.body as Record<string, unknown>,
          )
        }
      }

      return { ok: true }
    },
  )

  // Webhook management routes
  fastify.post<{
    Params: { owner: string; repo: string }
  }>('/api/github/webhooks/:owner/:repo', async (request, reply) => {
    const { owner, repo } = request.params
    const result = await createRepoWebhook(`${owner}/${repo}`)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    return { ok: true, webhookId: result.webhookId }
  })

  fastify.delete<{
    Params: { owner: string; repo: string }
  }>('/api/github/webhooks/:owner/:repo', async (request, reply) => {
    const { owner, repo } = request.params
    const result = await deleteRepoWebhook(`${owner}/${repo}`)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    return { ok: true }
  })

  fastify.post<{
    Params: { owner: string; repo: string }
  }>('/api/github/webhooks/:owner/:repo/recreate', async (request, reply) => {
    const { owner, repo } = request.params
    const result = await recreateRepoWebhook(`${owner}/${repo}`)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    return { ok: true }
  })

  fastify.post<{
    Params: { owner: string; repo: string }
  }>('/api/github/webhooks/:owner/:repo/test', async (request, reply) => {
    const { owner, repo } = request.params
    const result = await testWebhook(`${owner}/${repo}`)
    if (!result.ok) {
      return reply.status(500).send({ error: result.error })
    }
    return { ok: true }
  })
}
