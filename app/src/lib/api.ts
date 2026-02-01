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
    throw new Error(data.error || 'Failed to create terminal')
  }
  return res.json()
}

export async function updateTerminal(
  id: number,
  updates: { name?: string; cwd?: string },
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

export async function getMergedPRs(
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
  }[]
  hasMore: boolean
}> {
  const res = await fetch(
    `${API_BASE}/github/${owner}/${repo}/merged-prs?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error('Failed to fetch merged PRs')
  return res.json()
}

export async function getPRComments(
  owner: string,
  repo: string,
  prNumber: number,
  limit: number,
  offset: number,
  excludeAuthors?: string[],
): Promise<{
  comments: {
    author: string
    avatarUrl: string
    body: string
    createdAt: string
  }[]
  total: number
}> {
  let url = `${API_BASE}/github/${owner}/${repo}/pr/${prNumber}/comments?limit=${limit}&offset=${offset}`
  if (excludeAuthors && excludeAuthors.length > 0) {
    url += `&exclude=${excludeAuthors.map(encodeURIComponent).join(',')}`
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch PR comments')
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
