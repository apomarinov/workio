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

export interface ClaudeSession {
  session_id: string
  project_id: number
  name: string | null
  git_branch: string | null
  message_count: number | null
  status: string
  created_at: string
  updated_at: string
  path?: string
}
