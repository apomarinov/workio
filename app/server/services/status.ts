import type {
  ClaudeTunnelStatus,
  GitHubApiStatus,
  NgrokStatus,
  ServicesStatus,
} from '../../shared/types'
import { getIO } from '../io'

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

export function updateClaudeTunnel(
  stableId: string,
  patch: Partial<ClaudeTunnelStatus>,
) {
  const existing = servicesStatus.claudeTunnels[stableId]
  if (existing) {
    Object.assign(existing, patch)
  } else {
    servicesStatus.claudeTunnels[stableId] = {
      status: 'inactive',
      error: null,
      alias: '',
      bootstrapRetries: 0,
      tunnelRetries: 0,
      ...patch,
    }
  }
  emit()
}

export function removeClaudeTunnel(stableId: string) {
  delete servicesStatus.claudeTunnels[stableId]
  emit()
}

export function getServicesStatus(): ServicesStatus {
  return servicesStatus
}
