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

export async function createTerminal(
  cwd: string,
  name?: string,
  shell?: string,
  ssh_host?: string,
): Promise<Terminal> {
  const res = await fetch(`${API_BASE}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, name, shell, ssh_host }),
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

export async function deleteTerminal(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/terminals/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete terminal')
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
