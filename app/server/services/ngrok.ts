import { type ChildProcess, spawn } from 'node:child_process'
import { getSettings } from '@domains/settings/db'
import serverEvents from '../lib/events'
import { log } from '../logger'
import { updateNgrokStatus } from './status'

let ngrokProcess: ChildProcess | null = null
let ngrokUrl: string | null = null
let initPort: number | null = null
let initUseHttps = false

export function getNgrokUrl() {
  return ngrokUrl
}

export async function initNgrok(port: number, useHttps: boolean) {
  initPort = port
  initUseHttps = useHttps

  const settings = await getSettings()
  const token = settings.ngrok?.token
  const domain = settings.ngrok?.domain

  if (!token || !domain) {
    updateNgrokStatus({ status: 'inactive', error: null, url: null })
    log.info('[ngrok] No ngrok domain/token configured, skipping')
    return false
  }

  const scheme = useHttps ? 'https' : 'http'
  const args = [
    'http',
    `${scheme}://localhost:${port}`,
    `--domain=${domain}`,
    `--authtoken=${token}`,
    '--log=stdout',
    '--log-format=json',
  ]
  if (useHttps) {
    args.push('--upstream-tls-verify=false')
  }

  updateNgrokStatus({ status: 'starting' })

  try {
    const tunnelUrl = await new Promise<string>((resolve, reject) => {
      ngrokProcess = spawn('ngrok', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timeout = setTimeout(() => {
        reject(new Error('ngrok startup timed out'))
      }, 10000)

      ngrokProcess.stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n').filter(Boolean)) {
          try {
            const entry = JSON.parse(line)
            if (entry.msg === 'started tunnel' || entry.url) {
              clearTimeout(timeout)
              resolve(`https://${domain}`)
            }
          } catch {}
        }
      })

      ngrokProcess.stderr?.on('data', (data: Buffer) => {
        log.error(`[ngrok] ${data.toString().trim()}`)
      })

      ngrokProcess.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      ngrokProcess.on('exit', (code) => {
        clearTimeout(timeout)
        if (code) {
          reject(new Error(`ngrok exited with code ${code}`))
        }
      })
    })

    // Monitor ngrok process after startup — restart if it dies
    ngrokProcess?.on('exit', (code) => {
      log.warn(
        `[ngrok] Process exited with code ${code} after startup, restarting...`,
      )
      updateNgrokStatus({
        status: 'error',
        error: `exited with code ${code}, restarting...`,
      })
      ngrokProcess = null
      ngrokUrl = null
      setTimeout(() => initNgrok(port, useHttps), 10_000)
    })

    const oldUrl = ngrokUrl
    ngrokUrl = tunnelUrl
    updateNgrokStatus({ status: 'healthy', error: null, url: tunnelUrl })
    log.info(`[ngrok] Tunnel started: ${tunnelUrl}`)

    // If URL changed, notify listeners (webhooks) to update
    if (oldUrl && oldUrl !== tunnelUrl) {
      serverEvents.emit('ngrok:url-changed', tunnelUrl)
    }

    return true
  } catch (err) {
    log.error({ err }, '[ngrok] Failed to start tunnel')
    updateNgrokStatus({ status: 'error', error: String(err) })
    return false
  }
}

export function stopNgrok() {
  if (ngrokProcess) {
    ngrokProcess.kill('SIGTERM')
    ngrokProcess = null
  }
  ngrokUrl = null
  updateNgrokStatus({ status: 'inactive', error: null, url: null })
}

// Listen for settings changes
serverEvents.on('ngrok:config-changed', () => {
  if (initPort == null) return
  log.info('[ngrok] Config changed, restarting tunnel...')
  stopNgrok()
  initNgrok(initPort, initUseHttps)
})
