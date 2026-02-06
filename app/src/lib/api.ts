import type {
  SessionMessagesResponse,
  SessionWithProject,
  Settings,
  Terminal,
} from '../types'

const API_BASE = '/api'

export async function getTerminals(): Promise<Terminal[]> {
  const res = await fetch(`${API_BASE}/terminals`)
  if (!res.ok) throw new Error('Failed to fetch terminals')
  return res.json()
}

export interface SSHHostEntry {
  alias: string
  hostname: string
  user: string | null
}

export async function getSSHHosts(): Promise<SSHHostEntry[]> {
  const res = await fetch(`${API_BASE}/ssh/hosts`)
  if (!res.ok) throw new Error('Failed to fetch SSH hosts')
  return res.json()
}

export async function getGitHubRepos(query?: string): Promise<string[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : ''
  const res = await fetch(`${API_BASE}/github/repos${params}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.repos
}

export async function createTerminal(opts: {
  cwd: string
  name?: string
  shell?: string
  ssh_host?: string
  git_repo?: string
  conductor?: boolean
  workspaces_root?: string
  setup_script?: string
  delete_script?: string
  source_terminal_id?: number
}): Promise<Terminal> {
  const res = await fetch(`${API_BASE}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to create project')
  }
  return res.json()
}

export async function updateTerminal(
  id: number,
  updates: { name?: string },
): Promise<Terminal> {
  const res = await fetch(`${API_BASE}/terminals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to update terminal')
  }
  return res.json()
}

export async function deleteTerminal(
  id: number,
  opts?: { deleteDirectory?: boolean },
): Promise<boolean> {
  const url = opts?.deleteDirectory
    ? `${API_BASE}/terminals/${id}?deleteDirectory=1`
    : `${API_BASE}/terminals/${id}`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete terminal')
  return res.status === 202
}

export async function browseFolder(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/browse-folder`)
  if (res.status === 204) return null
  if (!res.ok) throw new Error('Failed to open folder picker')
  const data = await res.json()
  return data.path
}

export async function openFullDiskAccess(): Promise<void> {
  await fetch(`${API_BASE}/open-full-disk-access`, { method: 'POST' })
}

export async function openInExplorer(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/open-in-explorer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error('Failed to open file explorer')
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
  const res = await fetch(`${API_BASE}/list-directories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to list directories')
  return res.json()
}

export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id'>>,
): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to update settings')
  }
  return res.json()
}

export async function getClaudeSessions(): Promise<SessionWithProject[]> {
  const res = await fetch(`${API_BASE}/sessions`)
  if (!res.ok) throw new Error('Failed to fetch sessions')
  return res.json()
}

export async function getClaudeSession(
  sessionId: string,
): Promise<SessionWithProject> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`)
  if (!res.ok) throw new Error('Failed to fetch session')
  return res.json()
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update session')
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete session')
}

export async function deleteSessions(ids: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) throw new Error('Failed to delete sessions')
}

export async function getClosedPRs(
  owner: string,
  repo: string,
  limit: number,
  offset: number,
): Promise<{
  prs: {
    prNumber: number
    prTitle: string
    prUrl: string
    branch: string
    repo: string
    state: 'MERGED' | 'CLOSED'
  }[]
  hasMore: boolean
}> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/closed-prs?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error('Failed to fetch closed PRs')
  return res.json()
}

export async function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/request-review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer }),
    },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to request review')
  }
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to merge PR')
  }
}

export async function closePR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/close`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to close PR')
  }
}

export async function rerunFailedCheck(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrl: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/rerun-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkUrl }),
    },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to rerun check')
  }
}

export async function rerunAllFailedChecks(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrls: string[],
): Promise<{ rerunCount: number }> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/rerun-all-checks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkUrls }),
    },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to rerun checks')
  }
  return res.json()
}

export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/comment`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to add comment')
  }
}

export async function getSessionMessages(
  sessionId: string,
  limit: number,
  offset: number,
): Promise<SessionMessagesResponse> {
  const res = await fetch(
    `${API_BASE}/sessions/${sessionId}/messages?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error('Failed to fetch session messages')
  return res.json()
}

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
  const res = await fetch(`${API_BASE}/terminals/${terminalId}/branches`)
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to fetch branches')
  }
  return res.json()
}

export async function checkoutBranch(
  terminalId: number,
  branch: string,
  isRemote: boolean,
): Promise<{ success: boolean; branch: string; error?: string }> {
  const res = await fetch(`${API_BASE}/terminals/${terminalId}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, isRemote }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to checkout branch')
  }
  return data
}

export async function pullBranch(
  terminalId: number,
  branch: string,
): Promise<{ success: boolean; branch: string; error?: string }> {
  const res = await fetch(`${API_BASE}/terminals/${terminalId}/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to pull branch')
  }
  return data
}

export async function pushBranch(
  terminalId: number,
  branch: string,
  force?: boolean,
): Promise<{ success: boolean; branch: string; error?: string }> {
  const res = await fetch(`${API_BASE}/terminals/${terminalId}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, force }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to push branch')
  }
  return data
}

export async function rebaseBranch(
  terminalId: number,
  branch: string,
): Promise<{ success: boolean; branch: string; onto: string; error?: string }> {
  const res = await fetch(`${API_BASE}/terminals/${terminalId}/rebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to rebase branch')
  }
  return data
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
  const res = await fetch(`${API_BASE}/terminals/${terminalId}/branch`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, deleteRemote }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete branch')
  }
  return data
}

// Webhook management

export async function createWebhook(
  owner: string,
  repo: string,
): Promise<{ webhookId?: number }> {
  const res = await fetch(`${API_BASE}/github/webhooks/${owner}/${repo}`, {
    method: 'POST',
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to create webhook')
  }
  return res.json()
}

export async function deleteWebhook(
  owner: string,
  repo: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/github/webhooks/${owner}/${repo}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to delete webhook')
  }
}

export async function recreateWebhook(
  owner: string,
  repo: string,
): Promise<{ webhookId?: number }> {
  const res = await fetch(
    `${API_BASE}/github/webhooks/${owner}/${repo}/recreate`,
    {
      method: 'POST',
    },
  )
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to recreate webhook')
  }
  return res.json()
}

export async function testWebhook(owner: string, repo: string): Promise<void> {
  const res = await fetch(`${API_BASE}/github/webhooks/${owner}/${repo}/test`, {
    method: 'POST',
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to test webhook')
  }
}

// Notifications

import type { Notification } from '../types'

export async function getNotifications(
  limit = 50,
  offset = 0,
): Promise<{ notifications: Notification[]; total: number }> {
  const res = await fetch(
    `${API_BASE}/notifications?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error('Failed to fetch notifications')
  return res.json()
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/notifications/mark-all-read`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to mark notifications as read')
  return res.json()
}

export async function markNotificationRead(
  id: number,
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/notifications/${id}/read`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to mark notification as read')
  return res.json()
}

export async function deleteAllNotifications(): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE}/notifications`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete notifications')
  return res.json()
}
