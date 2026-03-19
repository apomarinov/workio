import type { Shell } from '@domains/workspace/schema'
import type {
  ChangedFile,
  InvolvedPRSummary,
  MergedPRSummary,
} from '../../shared/types'
import { getSocketId } from '../hooks/useSocket'
import type {
  MoveTarget,
  SessionMessagesResponse,
  SessionSearchMatch,
  SessionWithProject,
} from '../types'

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

// --- Terminals ---

export interface SSHHostEntry {
  alias: string
  hostname: string
  user: string | null
}

export async function getSSHHosts(): Promise<SSHHostEntry[]> {
  return api(`${API_BASE}/ssh/hosts`)
}

export async function auditSSHHost(
  host: string,
): Promise<{ maxSessions: number | null }> {
  try {
    return await api(`${API_BASE}/ssh/audit?host=${encodeURIComponent(host)}`)
  } catch {
    return { maxSessions: null }
  }
}

export async function fixSSHMaxSessions(
  host: string,
): Promise<{ success: boolean; error?: string }> {
  return api(`${API_BASE}/ssh/fix-max-sessions`, { body: { host } })
}

export async function getGitHubRepos(query?: string): Promise<string[]> {
  try {
    const params = query ? `?q=${encodeURIComponent(query)}` : ''
    const { repos } = await api<{ repos: string[] }>(
      `${API_BASE}/github/repos${params}`,
    )
    return repos
  } catch {
    return []
  }
}

export async function checkConductor(repo: string): Promise<boolean> {
  try {
    const data = await api<{ hasConductor: boolean }>(
      `${API_BASE}/github/conductor?repo=${encodeURIComponent(repo)}`,
    )
    return data.hasConductor === true
  } catch {
    return false
  }
}

export async function cancelWorkspace(terminalId: number): Promise<void> {
  await api(`${API_BASE}/terminals/${terminalId}/cancel-workspace`, {
    method: 'POST',
  })
}

export async function rerunSetup(terminalId: number): Promise<void> {
  await api(`${API_BASE}/terminals/${terminalId}/rerun-setup`, {
    method: 'POST',
  })
}

export async function clearSetupError(terminalId: number): Promise<void> {
  await api(`${API_BASE}/terminals/${terminalId}/clear-setup-error`, {
    method: 'POST',
  })
}

export async function browseFolder(): Promise<string | null> {
  const res = await apiFetch(`${API_BASE}/browse-folder`)
  if (res.status === 204) return null
  const data: { path: string } = await res.json()
  return data.path
}

export async function openFullDiskAccess(): Promise<void> {
  await api(`${API_BASE}/open-full-disk-access`, { method: 'POST' })
}

export async function openInIDE(
  path: string,
  ide: 'cursor' | 'vscode',
  terminalId?: number,
  sshHost?: string,
): Promise<void> {
  await api(`${API_BASE}/open-in-ide`, {
    body: {
      path,
      ide,
      ...(terminalId != null && { terminal_id: terminalId }),
      ...(sshHost && { ssh_host: sshHost }),
    },
  })
}

export async function openInExplorer(
  path: string,
  terminalId?: number,
): Promise<void> {
  await api(`${API_BASE}/open-in-explorer`, {
    body: {
      path,
      ...(terminalId != null && { terminal_id: terminalId }),
    },
  })
}

export interface DirEntry {
  name: string
  isDir: boolean
}

export interface DirResult {
  entries?: DirEntry[]
  hasMore?: boolean
  error?: string | null
}

export interface ListDirectoriesResponse {
  results: Record<string, DirResult>
}

export async function listDirectories(
  paths: string[],
  page?: number,
  hidden?: boolean,
  sshHost?: string,
): Promise<ListDirectoriesResponse> {
  const body: Record<string, unknown> = {
    paths,
    page: page ?? 0,
    hidden: hidden ?? false,
  }
  if (sshHost) body.ssh_host = sshHost
  return api(`${API_BASE}/list-directories`, { body })
}

export async function createDirectory(
  parentPath: string,
  name: string,
  sshHost?: string,
): Promise<{ path: string }> {
  const body: Record<string, unknown> = { path: parentPath, name }
  if (sshHost) body.ssh_host = sshHost
  return api(`${API_BASE}/create-directory`, { body })
}

// --- Permissions ---

export interface ActivePermission extends SessionWithProject {
  message_id: number
  source: 'ask_user_question' | 'terminal_prompt'
  tools: Record<string, unknown>
}

export async function getActivePermissions(): Promise<ActivePermission[]> {
  return api(`${API_BASE}/permissions/active`)
}

// --- Sessions ---

export async function getClaudeSessions(): Promise<SessionWithProject[]> {
  return api(`${API_BASE}/sessions`)
}

export async function getClaudeSession(
  sessionId: string,
): Promise<SessionWithProject> {
  return api(`${API_BASE}/sessions/${sessionId}`)
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string },
): Promise<void> {
  await api(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    body: updates,
  })
}

export async function deleteSession(sessionId: string): Promise<void> {
  await api(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function deleteSessions(ids: string[]): Promise<void> {
  await api(`${API_BASE}/sessions`, { method: 'DELETE', body: { ids } })
}

export async function cleanupOldSessions(
  weeks: number,
): Promise<{ deleted: number }> {
  return api(`${API_BASE}/sessions/cleanup`, { body: { weeks } })
}

export async function toggleFavoriteSession(
  sessionId: string,
): Promise<{ is_favorite: boolean }> {
  return api(`${API_BASE}/sessions/${sessionId}/favorite`, { method: 'POST' })
}

export async function searchSessionMessages(
  query: string | null,
  opts?: {
    repo?: string
    branch?: string
    recentOnly?: boolean
    signal?: AbortSignal
  },
): Promise<SessionSearchMatch[]> {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (opts?.repo) params.set('repo', opts.repo)
  if (opts?.branch) params.set('branch', opts.branch)
  if (opts?.recentOnly === false) params.set('all', '1')
  return api(`${API_BASE}/sessions/search?${params.toString()}`, {
    signal: opts?.signal,
  })
}

export async function getSessionMessages(
  sessionId: string,
  limit: number,
  offset: number,
): Promise<SessionMessagesResponse> {
  return api(
    `${API_BASE}/sessions/${sessionId}/messages?limit=${limit}&offset=${offset}`,
  )
}

// --- GitHub ---

export async function getClosedPRs(
  repos: string[],
  limit: number,
): Promise<MergedPRSummary[]> {
  const { prs } = await api<{ prs: MergedPRSummary[] }>(
    `${API_BASE}/github/closed-prs?repos=${encodeURIComponent(repos.join(','))}&limit=${limit}`,
    { retry: true },
  )
  return prs
}

export async function getInvolvedPRs(
  repos: string[],
  limit: number,
): Promise<InvolvedPRSummary[]> {
  const { prs } = await api<{ prs: InvolvedPRSummary[] }>(
    `${API_BASE}/github/involved-prs?repos=${encodeURIComponent(repos.join(','))}&limit=${limit}`,
    { retry: true },
  )
  return prs
}

export async function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
): Promise<void> {
  await api(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/request-review`,
    { body: { reviewer } },
  )
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/merge`, {
    body: { method },
  })
}

export async function closePR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/close`, {
    method: 'POST',
  })
}

export async function renamePR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/rename`, {
    body: { title },
  })
}

export async function editPR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string,
  draft?: boolean,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/edit`, {
    body: { title, body, draft },
  })
}

export async function rerunFailedCheck(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrl: string,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/rerun-check`, {
    body: { checkUrl },
  })
}

export async function rerunAllFailedChecks(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrls: string[],
): Promise<{ rerunCount: number }> {
  return api(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/rerun-all-checks`,
    { body: { checkUrls } },
  )
}

export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/comment`, {
    body: { body },
  })
}

export async function replyToReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<void> {
  await api(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/reply/${commentId}`,
    { body: { body } },
  )
}

export async function editComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
  type: 'issue_comment' | 'review_comment' | 'review',
): Promise<void> {
  await api(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/comment/${commentId}`,
    { method: 'PATCH', body: { body, type } },
  )
}

export async function addReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/reaction`, {
    body: { subjectId, subjectType, content, prNumber },
  })
}

export async function removeReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
): Promise<void> {
  await api(`${API_BASE}/github/${owner}/${repo}/reaction`, {
    method: 'DELETE',
    body: { subjectId, subjectType, content, prNumber },
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
): Promise<{ prNumber: number }> {
  return api(`${API_BASE}/github/${owner}/${repo}/pr/create`, {
    body: { head, base, title, body, draft },
  })
}

// --- Git operations ---

export interface BranchInfo {
  name: string
  current: boolean
  commitDate: string
}

export interface BranchesResponse {
  local: BranchInfo[]
  remote: BranchInfo[]
}

export async function getBranches(
  terminalId: number,
): Promise<BranchesResponse> {
  return api(`${API_BASE}/terminals/${terminalId}/branches`)
}

export async function fetchAll(
  terminalId: number,
): Promise<{ success: boolean }> {
  return api(`${API_BASE}/terminals/${terminalId}/fetch-all`, {
    method: 'POST',
  })
}

export async function checkoutBranch(
  terminalId: number,
  branch: string,
  isRemote: boolean,
): Promise<{ success: boolean; branch: string; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/checkout`, {
    body: { branch, isRemote },
  })
}

export async function pullBranch(
  terminalId: number,
  branch: string,
): Promise<{ success: boolean; branch: string; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/pull`, {
    body: { branch },
  })
}

export async function pushBranch(
  terminalId: number,
  branch: string,
  force?: boolean,
): Promise<{ success: boolean; branch: string; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/push`, {
    body: { branch, force },
  })
}

export async function rebaseBranch(
  terminalId: number,
  branch: string,
): Promise<{
  success: boolean
  branch: string
  onto: string
  error?: string
}> {
  return api(`${API_BASE}/terminals/${terminalId}/rebase`, {
    body: { branch },
  })
}

export async function createBranch(
  terminalId: number,
  name: string,
  from: string,
): Promise<{ success: boolean; branch: string; error?: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/create-branch`, {
    body: { name, from },
  })
}

export async function deleteBranch(
  terminalId: number,
  branch: string,
  deleteRemote?: boolean,
): Promise<{
  success: boolean
  branch: string
  deletedRemote?: boolean
  error?: string
}> {
  return api(`${API_BASE}/terminals/${terminalId}/branch`, {
    method: 'DELETE',
    body: { branch, deleteRemote },
  })
}

export async function renameBranch(
  terminalId: number,
  branch: string,
  newName: string,
  renameRemote?: boolean,
): Promise<{
  success: boolean
  branch: string
  newName: string
  renamedRemote?: boolean
}> {
  return api(`${API_BASE}/terminals/${terminalId}/rename-branch`, {
    body: { branch, newName, renameRemote },
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

export async function getHeadMessage(
  terminalId: number,
): Promise<{ message: string }> {
  return api(`${API_BASE}/terminals/${terminalId}/head-message`)
}

export interface PRCommit {
  hash: string
  message: string
  author: string
  date: string
}

export async function checkBranchConflicts(
  terminalId: number,
  head: string,
  base: string,
): Promise<{ hasConflicts: boolean }> {
  const params = new URLSearchParams({ head, base })
  return api(
    `${API_BASE}/terminals/${terminalId}/branch-conflicts?${params.toString()}`,
  )
}

export async function getCommitsBetween(
  terminalId: number,
  base: string,
  head: string,
): Promise<{ commits: PRCommit[]; noRemote?: boolean }> {
  const params = new URLSearchParams({ head, base })
  return api(`${API_BASE}/terminals/${terminalId}/commits?${params.toString()}`)
}

export async function getBranchCommits(
  terminalId: number,
  branch: string,
  limit = 20,
  offset = 0,
): Promise<{
  commits: PRCommit[]
  hasMore: boolean
  mergeBase?: string
  mergeBaseBranch?: string
}> {
  const params = new URLSearchParams({
    branch,
    limit: String(limit),
    offset: String(offset),
  })
  return api(
    `${API_BASE}/terminals/${terminalId}/branch-commits?${params.toString()}`,
  )
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

export async function getChangedFiles(
  terminalId: number,
  base?: string,
): Promise<{ files: ChangedFile[] }> {
  const params = base ? `?base=${encodeURIComponent(base)}` : ''
  return api(`${API_BASE}/terminals/${terminalId}/changed-files${params}`)
}

export async function getFileDiff(
  terminalId: number,
  filePath: string,
  fullFile?: boolean,
  base?: string,
): Promise<{ diff: string }> {
  const context = fullFile ? '99999' : '5'
  const params = new URLSearchParams({ path: filePath, context })
  if (base) params.set('base', base)
  return api(
    `${API_BASE}/terminals/${terminalId}/file-diff?${params.toString()}`,
  )
}

export async function getAllFilesDiff(
  terminalId: number,
  base?: string,
): Promise<{ diff: string }> {
  const params = new URLSearchParams({ context: '5' })
  if (base) params.set('base', base)
  return api(
    `${API_BASE}/terminals/${terminalId}/file-diff?${params.toString()}`,
  )
}

// --- Webhooks ---

export async function createWebhook(
  owner: string,
  repo: string,
): Promise<{ webhookId?: number }> {
  return api(`${API_BASE}/github/webhooks/${owner}/${repo}`, {
    method: 'POST',
  })
}

export async function deleteWebhook(
  owner: string,
  repo: string,
): Promise<void> {
  await api(`${API_BASE}/github/webhooks/${owner}/${repo}`, {
    method: 'DELETE',
  })
}

export async function recreateWebhook(
  owner: string,
  repo: string,
): Promise<{ webhookId?: number }> {
  return api(`${API_BASE}/github/webhooks/${owner}/${repo}/recreate`, {
    method: 'POST',
  })
}

export async function testWebhook(owner: string, repo: string): Promise<void> {
  await api(`${API_BASE}/github/webhooks/${owner}/${repo}/test`, {
    method: 'POST',
  })
}

// --- Shells ---

export async function createShellForTerminal(
  terminalId: number,
  name?: string,
): Promise<Shell> {
  return api(`${API_BASE}/terminals/${terminalId}/shells`, {
    body: { name },
  })
}

export async function deleteShell(shellId: number): Promise<void> {
  await api(`${API_BASE}/shells/${shellId}`, { method: 'DELETE' })
}

export async function writeToShell(
  shellId: number,
  data: string,
): Promise<void> {
  await api(`${API_BASE}/shells/${shellId}/write`, { body: { data } })
}

export async function interruptShell(shellId: number): Promise<void> {
  await api(`${API_BASE}/shells/${shellId}/interrupt`, { method: 'POST' })
}

export async function killShell(shellId: number): Promise<void> {
  await api(`${API_BASE}/shells/${shellId}/kill`, { method: 'POST' })
}

export async function renameShell(
  shellId: number,
  name: string,
): Promise<Shell> {
  return api(`${API_BASE}/shells/${shellId}`, {
    method: 'PATCH',
    body: { name },
  })
}

// --- Session backfill ---

export interface BackfillCheckResult {
  cwd: string
  encodedPath: string
  terminalId: number
  shellId: number
  totalFiles: number
  unbackfilledCount: number
}

export async function backfillCheck(
  weeksBack?: number,
): Promise<{ results: BackfillCheckResult[] }> {
  const params = weeksBack ? `?weeksBack=${weeksBack}` : ''
  return api(`${API_BASE}/sessions/backfill-check${params}`)
}

export async function backfillSessions(opts: {
  encodedPath: string
  cwd: string
  terminalId: number
  shellId: number
  weeksBack: number
}): Promise<{ backfilled: number }> {
  return api(`${API_BASE}/sessions/backfill`, { body: opts })
}

// --- Session move ---

export async function getMoveTargets(
  sessionId: string,
): Promise<{ targets: MoveTarget[] }> {
  return api(`${API_BASE}/sessions/${sessionId}/move-targets`)
}

export async function moveSession(
  sessionId: string,
  targetProjectPath: string,
  targetTerminalId: number,
): Promise<{ snapshotDir?: string }> {
  try {
    return await api(`${API_BASE}/sessions/${sessionId}/move`, {
      body: { targetProjectPath, targetTerminalId },
    })
  } catch (err) {
    if (err instanceof ApiError) {
      const newErr = new Error(err.message)
      ;(newErr as Error & { snapshotDir?: string }).snapshotDir = err.data
        ?.snapshotDir as string
      throw newErr
    }
    throw err
  }
}
