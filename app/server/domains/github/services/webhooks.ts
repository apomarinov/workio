import crypto from 'node:crypto'
import { WEBHOOK_EVENTS } from '@domains/github/schema'
import { getSettings, updateSettings } from '@domains/settings/db'
import serverEvents from '@server/lib/events'
import { execFileAsync } from '@server/lib/exec'
import { log } from '@server/logger'

export async function getOrCreateWebhookSecret() {
  const settings = await getSettings()
  if (settings.webhook_secret) {
    return settings.webhook_secret
  }

  const secret = crypto.randomBytes(32).toString('hex')
  await updateSettings({ webhook_secret: secret } as Record<string, unknown>)
  return secret
}

export async function updateAllWebhookUrls(newUrl: string) {
  const settings = await getSettings()
  const repoWebhooks = settings.repo_webhooks ?? {}

  if (Object.keys(repoWebhooks).length === 0) return

  log.info(`[webhooks] Updating webhook URLs to ${newUrl}`)

  for (const [repo, webhook] of Object.entries(repoWebhooks)) {
    if (webhook.missing) continue
    try {
      await updateWebhookUrl(repo, webhook.id, newUrl)
      log.info(`[webhooks] Updated webhook URL for ${repo}`)
    } catch (err) {
      log.error(err, `[webhooks] Failed to update webhook URL for ${repo}`)
    }
  }
}

async function updateWebhookUrl(
  repo: string,
  hookId: number,
  ngrokUrl: string,
) {
  const [owner, repoName] = repo.split('/')
  const webhookUrl = `${ngrokUrl}/api/webhooks/github`
  const secret = await getOrCreateWebhookSecret()

  await execFileAsync('gh', [
    'api',
    `repos/${owner}/${repoName}/hooks/${hookId}`,
    '-X',
    'PATCH',
    '-f',
    `config[url]=${webhookUrl}`,
    '-f',
    'config[content_type]=json',
    '-f',
    `config[secret]=${secret}`,
  ])
}

async function checkWebhookExists(repo: string, hookId: number) {
  try {
    const [owner, repoName] = repo.split('/')
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${hookId}`,
    ])
    return 'exists' as const
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (
      message.includes('admin:repo_hook') ||
      message.includes('403') ||
      message.includes('Resource not accessible')
    ) {
      return 'no_access' as const
    }
    if (message.includes('404') || message.includes('Not Found')) {
      return 'missing' as const
    }
    log.warn(
      `[webhooks] Transient error checking webhook ${hookId} for ${repo}: ${message}`,
    )
    return 'error' as const
  }
}

/** Try to find and adopt an existing webhook matching our URL. Returns webhookId or null. */
async function adoptExistingWebhook(
  repo: string,
  webhookUrl: string,
  secret: string,
) {
  const [owner, repoName] = repo.split('/')
  try {
    const { stdout } = await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks`,
    ])
    const hooks = JSON.parse(stdout) as {
      id: number
      config?: { url?: string }
    }[]
    const match = hooks.find((h) => h.config?.url === webhookUrl)
    if (!match) return null

    const eventsArgs = WEBHOOK_EVENTS.flatMap((e) => ['-f', `events[]=${e}`])
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${match.id}`,
      '-X',
      'PATCH',
      '-f',
      `config[url]=${webhookUrl}`,
      '-f',
      'config[content_type]=json',
      '-f',
      `config[secret]=${secret}`,
      ...eventsArgs,
    ])

    const settings = await getSettings()
    await updateSettings({
      repo_webhooks: {
        ...settings.repo_webhooks,
        [repo]: { id: match.id },
      },
    } as Record<string, unknown>)

    log.info(`[webhooks] Adopted existing webhook ${match.id} for ${repo}`)
    return match.id
  } catch (err) {
    log.error(err, `[webhooks] Failed to adopt existing webhook for ${repo}`)
    return null
  }
}

/** Create a webhook for a repo. Returns the webhook ID. */
export async function createRepoWebhook(repo: string) {
  const settings = await getSettings()
  const domain = settings.ngrok?.domain

  if (!domain) {
    throw new Error('ngrok not configured — set domain and token in Settings')
  }

  const secret = await getOrCreateWebhookSecret()
  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    throw new Error('Invalid repo format')
  }

  const webhookUrl = `https://${domain}/api/webhooks/github`
  const eventsArgs = WEBHOOK_EVENTS.flatMap((e) => ['-f', `events[]=${e}`])

  try {
    const { stdout } = await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks`,
      '-X',
      'POST',
      '-f',
      'name=web',
      '-f',
      `config[url]=${webhookUrl}`,
      '-f',
      'config[content_type]=json',
      '-f',
      `config[secret]=${secret}`,
      ...eventsArgs,
    ])

    const hook = JSON.parse(stdout) as { id: number }

    await updateSettings({
      repo_webhooks: {
        ...settings.repo_webhooks,
        [repo]: { id: hook.id },
      },
    } as Record<string, unknown>)

    log.info(`[webhooks] Created webhook ${hook.id} for ${repo}`)
    return hook.id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stdout = (err as { stdout?: string }).stdout ?? ''

    if (
      message.includes('Hook already exists') ||
      stdout.includes('Hook already exists')
    ) {
      const adoptedId = await adoptExistingWebhook(repo, webhookUrl, secret)
      if (adoptedId != null) return adoptedId
    }

    log.error(err, `[webhooks] Failed to create webhook for ${repo}`)
    throw new Error(message)
  }
}

export async function deleteRepoWebhook(repo: string) {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]

  if (!webhook) return

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    throw new Error('Invalid repo format')
  }

  try {
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${webhook.id}`,
      '-X',
      'DELETE',
    ])
  } catch {
    log.warn(
      `[webhooks] Could not delete webhook from GitHub for ${repo}, removing from DB anyway`,
    )
  }

  const { [repo]: _, ...rest } = settings.repo_webhooks ?? {}
  await updateSettings({ repo_webhooks: rest } as Record<string, unknown>)

  log.info(`[webhooks] Deleted webhook for ${repo}`)
}

export async function recreateRepoWebhook(repo: string) {
  await deleteRepoWebhook(repo)
  return createRepoWebhook(repo)
}

export async function testWebhook(repo: string) {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]

  if (!webhook || webhook.missing) {
    throw new Error('Webhook not found')
  }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    throw new Error('Invalid repo format')
  }

  try {
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${webhook.id}/pings`,
      '-X',
      'POST',
    ])
    log.info(`[webhooks] Pinged webhook for ${repo}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(err, `[webhooks] Failed to ping webhook for ${repo}`)
    throw new Error(message)
  }
}

// Background polling
const WEBHOOK_VALIDATION_INTERVAL = 5 * 60 * 1000
let validationPollingId: NodeJS.Timeout | null = null

export function startWebhookValidationPolling() {
  if (validationPollingId) return
  validateStoredWebhooks()
  validationPollingId = setInterval(
    validateStoredWebhooks,
    WEBHOOK_VALIDATION_INTERVAL,
  )
}

export function stopWebhookValidationPolling() {
  if (validationPollingId) {
    clearInterval(validationPollingId)
    validationPollingId = null
  }
}

async function validateStoredWebhooks() {
  const settings = await getSettings()
  const repoWebhooks = settings.repo_webhooks ?? {}

  if (Object.keys(repoWebhooks).length === 0) {
    log.info('[webhooks] No webhooks to validate')
    return
  }

  log.info(
    `[webhooks] Validating ${Object.keys(repoWebhooks).length} webhook(s)`,
  )

  const updatedWebhooks = { ...repoWebhooks }
  let hasChanges = false

  for (const [repo, webhook] of Object.entries(repoWebhooks)) {
    const result = await checkWebhookExists(repo, webhook.id)

    if (result === 'no_access') {
      if (webhook.missing) {
        updatedWebhooks[repo] = { id: webhook.id }
        hasChanges = true
        log.info(
          `[webhooks] No admin access for ${repo}, cleared incorrect missing flag`,
        )
      }
      continue
    }

    if (result === 'error') {
      continue
    }

    if (result === 'missing' && !webhook.missing) {
      updatedWebhooks[repo] = { ...webhook, missing: true }
      hasChanges = true
      log.warn(
        `[webhooks] Webhook ${webhook.id} for ${repo} not found in GitHub, marked as missing`,
      )
    } else if (result === 'exists' && webhook.missing) {
      updatedWebhooks[repo] = { id: webhook.id }
      hasChanges = true
      log.info(
        `[webhooks] Webhook for ${repo} found again, cleared missing flag`,
      )
    }
  }

  if (hasChanges) {
    await updateSettings({ repo_webhooks: updatedWebhooks } as Record<
      string,
      unknown
    >)
    log.info('[webhooks] Webhook validation complete, settings updated')
  } else {
    log.info('[webhooks] Webhook validation complete, no changes')
  }
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
) {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  return signature === expected
}

// Update webhook URLs when ngrok tunnel URL changes
serverEvents.on('ngrok:url-changed', (newUrl) => {
  updateAllWebhookUrls(newUrl).catch((err) => {
    log.error(
      err,
      '[webhooks] Failed to update webhook URLs after ngrok URL change',
    )
  })
})
