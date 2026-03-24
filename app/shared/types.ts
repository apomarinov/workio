export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface ChangedFile {
  path: string
  status: FileStatus
  added: number
  removed: number
  oldPath?: string
}

export interface WorkspacePayload {
  terminalId: number
  name: string
  git_repo?: {
    repo: string
    status: 'setup' | 'done' | 'failed'
    workspaces_root?: string
    error?: string
  }
  setup?: {
    conductor?: boolean
    setup?: string
    delete?: string
    status: 'setup' | 'delete' | 'done' | 'failed'
    error?: string
  }
  deleted?: boolean
}

export interface ShellClient {
  device: string
  browser: string
  ip: string
  isPrimary?: boolean
}

export interface ShellClientsPayload {
  shellId: number
  clients: ShellClient[]
}

// Service status types
export type ServiceStatus = 'inactive' | 'starting' | 'healthy' | 'degraded' | 'error'

export interface GitHubApiStatus {
  status: ServiceStatus
  error: string | null
  remaining: number | null
  limit: number | null
  reset: number | null
  usedLastCycle: number | null
}

export interface NgrokStatus {
  status: ServiceStatus
  error: string | null
  url: string | null
}

export interface ClaudeSubStatus {
  status: ServiceStatus
  error: string | null
  retries: number
}

export interface ClaudeTunnelStatus {
  alias: string
  bootstrap: ClaudeSubStatus
  tunnel: ClaudeSubStatus
}

export interface ServicesStatus {
  githubRest: GitHubApiStatus
  githubGraphql: GitHubApiStatus
  ngrok: NgrokStatus
  claudeTunnels: Record<string, ClaudeTunnelStatus>
}
