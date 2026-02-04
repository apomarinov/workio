import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import ngrok from '@ngrok/ngrok'
import { getSettings, updateSettings } from '../db'
import { env } from '../env'
import { log } from '../logger'

const execFileAsync = promisify(execFile)

let ngrokListener: ngrok.Listener | null = null

const WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
]

export async function getOrCreateWebhookSecret(): Promise<string> {
  const settings = await getSettings()
  if (settings.webhook_secret) {
    return settings.webhook_secret
  }

  const secret = crypto.randomBytes(32).toString('hex')
  await updateSettings({ webhook_secret: secret } as Record<string, unknown>)
  return secret
}

export async function initNgrok(port: number): Promise<void> {
  const token = env.NGROK_AUTHTOKEN
  const domain = env.NGROK_DOMAIN

  // Domain requires token
  if (!token) {
    await updateSettings({ ngrok_url: null } as Record<string, unknown>)
    throw new Error('NGROK_DOMAIN requires NGROK_AUTHTOKEN')
  }

  // Start ngrok (works without token, just with limitations)
  ngrokListener = await ngrok.forward({
    addr: port,
    authtoken: token,
    domain: domain,
  })

  const ngrokUrl = ngrokListener.url()!
  log.info(
    `[webhooks] ngrok tunnel started: ${ngrokUrl}${domain ? ' (static)' : ''}`,
  )

  // Check if URL changed - update webhooks if so
  const settings = await getSettings()
  const storedUrl = settings.ngrok_url
  const repoWebhooks = settings.repo_webhooks ?? {}

  if (ngrokUrl !== storedUrl && Object.keys(repoWebhooks).length > 0) {
    log.info(
      `[webhooks] ngrok URL changed from ${storedUrl} to ${ngrokUrl}, updating webhooks`,
    )

    for (const [repo, webhook] of Object.entries(repoWebhooks)) {
      if (webhook.missing) continue // Skip missing webhooks

      try {
        await updateWebhookUrl(repo, webhook.id, ngrokUrl)
        log.info(`[webhooks] Updated webhook URL for ${repo}`)
      } catch (err) {
        log.error(err, `[webhooks] Failed to update webhook URL for ${repo}`)
      }
    }

    await updateSettings({ ngrok_url: ngrokUrl } as Record<string, unknown>)
  } else if (ngrokUrl !== storedUrl) {
    // No webhooks, just store the URL
    await updateSettings({ ngrok_url: ngrokUrl } as Record<string, unknown>)
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

async function checkWebhookExists(
  repo: string,
  hookId: number,
): Promise<boolean> {
  try {
    const [owner, repoName] = repo.split('/')
    await execFileAsync('gh', [
      'api',
      `repos/${owner}/${repoName}/hooks/${hookId}`,
    ])
    return true
  } catch {
    return false
  }
}

export async function createRepoWebhook(
  repo: string,
): Promise<{ ok: boolean; error?: string; webhookId?: number }> {
  const settings = await getSettings()
  const ngrokUrl = settings.ngrok_url

  if (!ngrokUrl) {
    return {
      ok: false,
      error: 'ngrok not running - set NGROK_AUTHTOKEN and restart server',
    }
  }

  const secret = await getOrCreateWebhookSecret()
  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    return { ok: false, error: 'Invalid repo format' }
  }

  const webhookUrl = `${ngrokUrl}/api/webhooks/github`
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

  // Only call GitHub API if not marked as missing
  if (!webhook.missing) {
    try {
      await execFileAsync('gh', [
        'api',
        `repos/${owner}/${repoName}/hooks/${webhook.id}`,
        '-X',
        'DELETE',
      ])
    } catch {
      // Already deleted or no access - fine
    }
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
    const exists = await checkWebhookExists(repo, webhook.id)

    if (!exists && !webhook.missing) {
      updatedWebhooks[repo] = { ...webhook, missing: true }
      hasChanges = true
      log.warn(
        `[webhooks] Webhook ${webhook.id} for ${repo} not found in GitHub, marked as missing`,
      )
    } else if (exists && webhook.missing) {
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
