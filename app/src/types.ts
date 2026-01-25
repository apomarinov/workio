export interface TerminalSession {
  id: number
  project_id: number
  name: string | null
  pid: number | null
  status: 'running' | 'stopped'
  created_at: string
  updated_at: string
  // Joined from projects table
  path?: string
}

export interface Project {
  id: number
  path: string
  active_session_id: string | null  // UUID from claude sessions table
}
