import { getSocketId } from '../hooks/useSocket'
import { api as gh } from './trpc'

const API_BASE = '/api'

export class ApiError extends Error {
  status: number
  data: Record<string, unknown> | null

  constructor(status: number, data: Record<string, unknown> | null) {
    super(
      (data?.message || data?.error || `Request failed (${status})`) as string,
    )
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

interface ApiInit extends Omit<RequestInit, 'body'> {
  body?: RequestInit['body'] | Record<string, unknown>
  retry?: boolean
}

/**
 * Low-level fetch wrapper: attaches socket ID on mutations,
 * handles retries, and throws ApiError on non-OK responses.
 * Returns the raw Response for callers that need status codes.
 *
 * When `body` is a plain object, it is JSON-stringified and the
 * Content-Type / method headers are set automatically (defaults to POST).
 */
async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiInit,
): Promise<Response> {
  // Auto-serialize plain-object bodies as JSON
  if (
    init?.body != null &&
    Object.getPrototypeOf(init.body) === Object.prototype
  ) {
    init = {
      method: 'POST',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: JSON.stringify(init.body),
    }
  }

  const method = init?.method?.toUpperCase()
  if (method && method !== 'GET' && method !== 'HEAD') {
    const socketId = getSocketId()
    if (socketId) {
      const headers = new Headers(init?.headers)
      headers.set('x-socket-id', socketId)
      init = { ...init, headers }
    }
  }

  // Body is now guaranteed to be serialized; safe to pass to fetch
  const fetchInit = init as RequestInit | undefined

  if (init?.retry) {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(input, fetchInit)
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new ApiError(res.status, data)
        }
        return res
      } catch (err) {
        if (err instanceof ApiError) throw err
        lastError = err
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
        }
      }
    }
    throw lastError
  }

  const res = await fetch(input, fetchInit)
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data)
  }
  return res
}

/**
 * High-level API helper: calls apiFetch and parses JSON.
 * Handles 204 No Content by returning undefined.
 */
async function api<T = void>(
  input: RequestInfo | URL,
  init?: ApiInit,
): Promise<T> {
  const res = await apiFetch(input, init)
  if (res.status === 204) return undefined as T
  return res.json()
}

// --- GitHub ---

export async function getGitHubRepos(query?: string) {
  try {
    const { repos } = await gh.github.repos.query({ q: query })
    return repos
  } catch {
    return [] as string[]
  }
}

export async function checkConductor(repo: string) {
  try {
    const { hasConductor } = await gh.github.conductor.query({ repo })
    return hasConductor
  } catch {
    return false
  }
}

export async function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
) {
  await gh.github.requestReview.mutate({ owner, repo, prNumber, reviewer })
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
) {
  await gh.github.merge.mutate({ owner, repo, prNumber, method })
}

export async function closePR(owner: string, repo: string, prNumber: number) {
  await gh.github.close.mutate({ owner, repo, prNumber })
}

export async function renamePR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
) {
  await gh.github.rename.mutate({ owner, repo, prNumber, title })
}

export async function editPR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string,
  draft?: boolean,
) {
  await gh.github.edit.mutate({ owner, repo, prNumber, title, body, draft })
}

export async function rerunFailedCheck(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrl: string,
) {
  await gh.github.rerunCheck.mutate({ owner, repo, prNumber, checkUrl })
}

export async function rerunAllFailedChecks(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrls: string[],
) {
  return gh.github.rerunAllChecks.mutate({ owner, repo, prNumber, checkUrls })
}

export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
) {
  await gh.github.comment.mutate({ owner, repo, prNumber, body })
}

export async function replyToReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
) {
  await gh.github.replyToComment.mutate({
    owner,
    repo,
    prNumber,
    commentId,
    body,
  })
}

export async function editComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
  type: 'issue_comment' | 'review_comment' | 'review',
) {
  await gh.github.editComment.mutate({
    owner,
    repo,
    prNumber,
    commentId,
    body,
    type,
  })
}

export async function addReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  await gh.github.addReactionMutation.mutate({
    owner,
    repo,
    subjectId,
    subjectType,
    content,
    prNumber,
  })
}

export async function removeReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  await gh.github.removeReactionMutation.mutate({
    owner,
    repo,
    subjectId,
    subjectType,
    content,
    prNumber,
  })
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
  return gh.github.create.mutate({
    owner,
    repo,
    head,
    base,
    title,
    body,
    draft,
  })
}

// --- Git branch operations ---

export async function getBranches(terminalId: number) {
  return gh.git.branches.list.query({ terminalId })
}

export async function fetchAll(terminalId: number) {
  await gh.git.branches.fetchAllMutation.mutate({ terminalId })
}

export async function checkoutBranch(
  terminalId: number,
  branch: string,
  _isRemote: boolean,
) {
  await gh.git.branches.checkoutMutation.mutate({ terminalId, branch })
}

export async function pullBranch(terminalId: number, branch: string) {
  await gh.git.branches.pullMutation.mutate({ terminalId, branch })
}

export async function pushBranch(
  terminalId: number,
  branch: string,
  force?: boolean,
) {
  await gh.git.branches.pushMutation.mutate({ terminalId, branch, force })
}

export async function rebaseBranch(terminalId: number, branch: string) {
  return gh.git.branches.rebaseMutation.mutate({ terminalId, branch })
}

export async function createBranch(
  terminalId: number,
  name: string,
  from: string,
) {
  await gh.git.branches.createBranchMutation.mutate({ terminalId, name, from })
}

export async function deleteBranch(
  terminalId: number,
  branch: string,
  deleteRemote?: boolean,
) {
  return gh.git.branches.deleteBranchMutation.mutate({
    terminalId,
    branch,
    deleteRemote,
  })
}

export async function renameBranch(
  terminalId: number,
  branch: string,
  newName: string,
  renameRemote?: boolean,
) {
  return gh.git.branches.renameBranchMutation.mutate({
    terminalId,
    branch,
    newName,
    renameRemote,
  })
}

export async function commitChanges(
  terminalId: number,
  message: string,
  amend?: boolean,
  noVerify?: boolean,
  files?: string[],
): Promise<{ success: boolean; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/commit`, {
    body: { message, amend, noVerify, files },
  })
}

export async function discardChanges(
  terminalId: number,
  files: string[],
): Promise<{ success: boolean; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/discard`, {
    body: { files },
  })
}

// --- Git diff operations (imperative callers only) ---

export async function getHeadMessage(terminalId: number) {
  return gh.git.diff.headMessage.query({ terminalId })
}

export async function checkBranchConflicts(
  terminalId: number,
  head: string,
  base: string,
) {
  return gh.git.diff.branchConflicts.query({ terminalId, head, base })
}

export async function getBranchCommits(
  terminalId: number,
  branch: string,
  limit = 20,
  offset = 0,
) {
  return gh.git.diff.branchCommits.query({ terminalId, branch, limit, offset })
}

export async function getChangedFiles(terminalId: number, base?: string) {
  return gh.git.diff.changedFiles.query({ terminalId, base })
}

export async function undoCommit(
  terminalId: number,
  commitHash: string,
): Promise<{ success: boolean; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/undo-commit`, {
    body: { commitHash },
  })
}

export async function dropCommit(
  terminalId: number,
  commitHash: string,
): Promise<{ success: boolean; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/drop-commit`, {
    body: { commitHash },
  })
}

// --- Webhooks ---

export async function createWebhook(owner: string, repo: string) {
  return gh.github.createWebhook.mutate({ owner, repo })
}

export async function deleteWebhook(owner: string, repo: string) {
  await gh.github.deleteWebhook.mutate({ owner, repo })
}

export async function recreateWebhook(owner: string, repo: string) {
  await gh.github.recreateWebhook.mutate({ owner, repo })
}

export async function testWebhook(owner: string, repo: string) {
  await gh.github.testWebhookMutation.mutate({ owner, repo })
}
