import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useSettings } from '@/hooks/useSettings'

export function useWebhookWarning(): {
  hasWarning: boolean
  missingCount: number
  orphanedCount: number
  noNgrok: boolean
} {
  const { settings } = useSettings()
  const { terminals } = useWorkspaceContext()

  const repoWebhooks = settings?.repo_webhooks ?? {}
  const terminalRepos = new Set(
    terminals.map((t) => t.git_repo?.repo).filter(Boolean),
  )

  let missingCount = 0
  for (const repo of terminalRepos) {
    if (repoWebhooks[repo as string]?.missing) missingCount++
  }

  let orphanedCount = 0
  for (const repo of Object.keys(repoWebhooks)) {
    if (!terminalRepos.has(repo)) orphanedCount++
  }

  const noNgrok = !settings?.ngrok?.domain
  const hasWarning = missingCount > 0 || orphanedCount > 0 || noNgrok

  return { hasWarning, missingCount, orphanedCount, noNgrok }
}
