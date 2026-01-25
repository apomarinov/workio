import type { TerminalSession, ClaudeSession } from '../types'

const API_BASE = '/api'

export async function getSessions(): Promise<TerminalSession[]> {
  const res = await fetch(`${API_BASE}/sessions`)
  if (!res.ok) throw new Error('Failed to fetch sessions')
  return res.json()
}

export async function createSession(cwd: string, name?: string): Promise<TerminalSession> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, name }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to create session')
  }
  return res.json()
}

export async function updateSession(id: number, updates: { name?: string }): Promise<TerminalSession> {
  const res = await fetch(`${API_BASE}/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update session')
  return res.json()
}

export async function deleteSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete session')
}

export async function getClaudeSessions(): Promise<ClaudeSession[]> {
  const res = await fetch(`${API_BASE}/claude-sessions`)
  if (!res.ok) throw new Error('Failed to fetch Claude sessions')
  return res.json()
}
