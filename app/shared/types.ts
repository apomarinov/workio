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
