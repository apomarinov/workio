import type { SessionWithProject, Settings, Terminal } from '../types'

const API_BASE = '/api'

export async function getTerminals(): Promise<Terminal[]> {
  const res = await fetch(`${API_BASE}/terminals`)
  if (!res.ok) throw new Error('Failed to fetch terminals')
  return res.json()
}

export async function createTerminal(
  cwd: string,
  name?: string,
  shell?: string,
): Promise<Terminal> {
  const res = await fetch(`${API_BASE}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, name, shell }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to create terminal')
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
  if (!res.ok) throw new Error('Failed to update terminal')
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
  settings: Partial<Settings>,
): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
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

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete session')
}
