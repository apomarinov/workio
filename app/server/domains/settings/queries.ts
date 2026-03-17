import { getAllTerminals } from '../../db'
import { publicProcedure } from '../../trpc/init'
import { getOrCreateVapidKeys, getSettings } from './db'

export const get = publicProcedure.query(async () => {
  const settings = await getSettings()
  const terminals = await getAllTerminals()

  const repoWebhooks = settings.repo_webhooks ?? {}

  // Get repos from terminals
  const terminalRepos = new Set<string>()
  for (const terminal of terminals) {
    const repo = (terminal.git_repo as { repo?: string } | null)?.repo
    if (repo) {
      terminalRepos.add(repo)
    }
  }

  // Count missing webhooks
  let missingWebhookCount = 0
  for (const repo of terminalRepos) {
    const webhook = repoWebhooks[repo]
    if (webhook?.missing) {
      missingWebhookCount++
    }
  }

  // Count orphaned webhooks
  let orphanedWebhookCount = 0
  for (const repo of Object.keys(repoWebhooks)) {
    if (!terminalRepos.has(repo)) {
      orphanedWebhookCount++
    }
  }

  return {
    ...settings,
    missingWebhookCount,
    orphanedWebhookCount,
  }
})

export const vapidKey = publicProcedure.query(async () => {
  const { publicKey } = await getOrCreateVapidKeys()
  return { publicKey }
})
