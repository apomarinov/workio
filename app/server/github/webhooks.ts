import crypto from 'node:crypto'
import { getSettings, updateSettings } from '@domains/settings/db'
import { WEBHOOK_EVENTS } from '../../shared/types'
import serverEvents from '../lib/events'
import { execFileAsync } from '../lib/exec'
import { log } from '../logger'

export async function getOrCreateWebhookSecret(): Promise<string> {
  const settings = await getSettings()
  if (settings.webhook_secret) {
    return settings.webhook_secret
  }

  const secret = crypto.randomBytes(32).toString('hex')
  await updateSettings({ webhook_secret: secret } as Record<string, unknown>)
  return secret
}

/**
 * Update all stored webhook URLs to point to the new ngrok URL.
 * Called by the ngrok service when the tunnel URL changes.
 */
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
): Promise<void> {
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

/**
 * Check if a webhook exists. Returns:
 * - 'exists' if the webhook is accessible
 * - 'missing' if it was deleted (404)
 * - 'no_access' if the user lacks admin permissions (403)
 * - 'error' if the check failed due to a transient error (network, timeout, etc.)
 */
async function checkWebhookExists(
  repo: string,
  hookId: number,
): Promise<'exists' | 'missing' | 'no_access' | 'error'> {
  try {
    const [owner, repoName] = repo.split('/')
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${hookId}`,
    ])
    return 'exists'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // No admin access: gh returns 404 with scope hint, or 403
    if (
      message.includes('admin:repo_hook') ||
      message.includes('403') ||
      message.includes('Resource not accessible')
    ) {
      return 'no_access'
    }
    // Actual 404 — webhook was deleted
    if (message.includes('404') || message.includes('Not Found')) {
      return 'missing'
    }
    // Network errors, timeouts, DNS failures — don't mark as missing
    log.warn(
      `[webhooks] Transient error checking webhook ${hookId} for ${repo}: ${message}`,
    )
    return 'error'
  }
}

/**
 * Find an existing webhook matching our URL on the repo, update its config, and store it.
 */
async function adoptExistingWebhook(
  repo: string,
  webhookUrl: string,
  secret: string,
): Promise<{ ok: boolean; webhookId?: number } | null> {
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

    // Update the existing hook's secret and events
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
    return { ok: true, webhookId: match.id }
  } catch (err) {
    log.error(err, `[webhooks] Failed to adopt existing webhook for ${repo}`)
    return null
  }
}

export async function createRepoWebhook(
  repo: string,
): Promise<{ ok: boolean; error?: string; webhookId?: number }> {
  const settings = await getSettings()
  const domain = settings.ngrok?.domain

  if (!domain) {
    return {
      ok: false,
      error: 'ngrok not configured — set domain and token in Settings',
    }
  }

  const secret = await getOrCreateWebhookSecret()
  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    return { ok: false, error: 'Invalid repo format' }
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
    return { ok: true, webhookId: hook.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stdout = (err as { stdout?: string }).stdout ?? ''

    // Hook already exists on this repo — find it and adopt it
    if (
      message.includes('Hook already exists') ||
      stdout.includes('Hook already exists')
    ) {
      const adopted = await adoptExistingWebhook(repo, webhookUrl, secret)
      if (adopted) return adopted
    }

    log.error(err, `[webhooks] Failed to create webhook for ${repo}`)
    return { ok: false, error: message }
  }
}

export async function deleteRepoWebhook(
  repo: string,
): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]

  if (!webhook) return { ok: true }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    return { ok: false, error: 'Invalid repo format' }
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

  // Always remove from DB
  const { [repo]: _, ...rest } = settings.repo_webhooks ?? {}
  await updateSettings({ repo_webhooks: rest } as Record<string, unknown>)

  log.info(`[webhooks] Deleted webhook for ${repo}`)
  return { ok: true }
}

export async function recreateRepoWebhook(
  repo: string,
): Promise<{ ok: boolean; error?: string; webhookId?: number }> {
  await deleteRepoWebhook(repo)
  return createRepoWebhook(repo)
}

export async function testWebhook(
  repo: string,
): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings()
  const webhook = settings.repo_webhooks?.[repo]

  if (!webhook || webhook.missing) {
    return { ok: false, error: 'Webhook not found' }
  }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    return { ok: false, error: 'Invalid repo format' }
  }

  try {
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${webhook.id}/pings`,
      '-X',
      'POST',
    ])
    log.info(`[webhooks] Pinged webhook for ${repo}`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(err, `[webhooks] Failed to ping webhook for ${repo}`)
    return { ok: false, error: message }
  }
}

// Background polling - validate webhooks every 5 minutes
const WEBHOOK_VALIDATION_INTERVAL = 5 * 60 * 1000

let validationPollingId: NodeJS.Timeout | null = null

export function startWebhookValidationPolling(): void {
  if (validationPollingId) return

  // Run immediately, then every 5 min
  validateStoredWebhooks()
  validationPollingId = setInterval(
    validateStoredWebhooks,
    WEBHOOK_VALIDATION_INTERVAL,
  )
}

export function stopWebhookValidationPolling(): void {
  if (validationPollingId) {
    clearInterval(validationPollingId)
    validationPollingId = null
  }
}

async function validateStoredWebhooks(): Promise<void> {
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
      // User doesn't have admin access to check webhooks - skip validation
      // If it was previously marked missing due to this, clear the flag
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
      // Transient error (network, timeout, DNS) — don't change webhook state
      continue
    }

    if (result === 'missing' && !webhook.missing) {
      updatedWebhooks[repo] = { ...webhook, missing: true }
      hasChanges = true
      log.warn(
        `[webhooks] Webhook ${webhook.id} for ${repo} not found in GitHub, marked as missing`,
      )
    } else if (result === 'exists' && webhook.missing) {
      // Webhook exists again (recreated externally?) - clear missing flag
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
): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  return signature === expected
}

// Update webhook URLs when ngrok tunnel URL changes
serverEvents.on('ngrok:url-changed', (newUrl: string) => {
  updateAllWebhookUrls(newUrl).catch((err) => {
    log.error(
      err,
      '[webhooks] Failed to update webhook URLs after ngrok URL change',
    )
  })
})
