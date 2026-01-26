export interface Terminal {
  id: number
  cwd: string
  name: string | null
  shell: string | null
  pid: number | null
  status: 'running' | 'stopped'
  active_cmd: string | null
  orphaned?: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  path: string
}

export interface Session {
  session_id: string
  project_id: number
  terminal_id: number | null
  name: string | null
  git_branch: string | null
  message_count: number | null
  status: 'started' | 'active' | 'done' | 'ended' | 'permission_needed' | 'idle'
  transcript_path: string | null
  created_at: string
  updated_at: string
}

export interface Prompt {
  id: number
  session_id: string
  prompt: string | null
  created_at: string
}

export interface Message {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  body: string
  created_at: string
}

export interface Hook {
  id: number
  session_id: string
  hook_type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface HookEvent {
  session_id: string
  hook_type: string
  project_path: string
}

export interface Settings {
  id: number
  default_shell: string
  font_size: number | null
}
