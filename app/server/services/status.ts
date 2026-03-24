import { getIO } from '../io'

// Service status types
export type ServiceStatus =
  | 'inactive'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'error'

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

const defaultGitHubApiStatus: GitHubApiStatus = {
  status: 'inactive',
  error: null,
  remaining: null,
  limit: null,
  reset: null,
  usedLastCycle: null,
}

const defaultNgrokStatus: NgrokStatus = {
  status: 'inactive',
  error: null,
  url: null,
}

const defaultSubStatus: ClaudeSubStatus = {
  status: 'inactive',
  error: null,
  retries: 0,
}

const servicesStatus: ServicesStatus = {
  githubRest: { ...defaultGitHubApiStatus },
  githubGraphql: { ...defaultGitHubApiStatus },
  ngrok: { ...defaultNgrokStatus },
  claudeTunnels: {},
}

function emit() {
  getIO()?.emit('services:status', servicesStatus)
}

export function updateGithubRest(patch: Partial<GitHubApiStatus>) {
  Object.assign(servicesStatus.githubRest, patch)
  emit()
}

export function updateGithubGraphql(patch: Partial<GitHubApiStatus>) {
  Object.assign(servicesStatus.githubGraphql, patch)
  emit()
}

export function updateNgrokStatus(patch: Partial<NgrokStatus>) {
  Object.assign(servicesStatus.ngrok, patch)
  emit()
}

function ensureHost(stableId: string, alias?: string) {
  if (!servicesStatus.claudeTunnels[stableId]) {
    servicesStatus.claudeTunnels[stableId] = {
      alias: alias ?? '',
      bootstrap: { ...defaultSubStatus },
      tunnel: { ...defaultSubStatus },
    }
  } else if (alias) {
    servicesStatus.claudeTunnels[stableId].alias = alias
  }
  return servicesStatus.claudeTunnels[stableId]
}

export function updateClaudeBootstrap(
  stableId: string,
  patch: Partial<ClaudeSubStatus> & { alias?: string },
) {
  const host = ensureHost(stableId, patch.alias)
  const { alias: _, ...subPatch } = patch
  Object.assign(host.bootstrap, subPatch)
  emit()
}

export function updateClaudeTunnel(
  stableId: string,
  patch: Partial<ClaudeSubStatus>,
) {
  const host = ensureHost(stableId)
  Object.assign(host.tunnel, patch)
  emit()
}

export function removeClaudeTunnel(stableId: string) {
  delete servicesStatus.claudeTunnels[stableId]
  emit()
}

export function getServicesStatus(): ServicesStatus {
  return servicesStatus
}
