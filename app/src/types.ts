export interface Terminal {
  id: number
  cwd: string
  name: string | null
  pid: number | null
  status: 'running' | 'stopped'
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  path: string
}
