import { X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getLocalIp } from '@server/lib/network'
import { publicProcedure } from '@server/trpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { getSettings } from './db'
import { DEFAULT_CONFIG } from './schema'

export const get = publicProcedure.query(async () => {
  const settings = await getSettings()
  const patches: Record<string, unknown> = {}

  // Backfill missing keymap entries
  if (settings.keymap) {
    const defaultKeys = Object.keys(
      DEFAULT_CONFIG.keymap,
    ) as (keyof typeof DEFAULT_CONFIG.keymap)[]
    const missingKeys = defaultKeys.filter((k) => !(k in settings.keymap!))
    if (missingKeys.length > 0) {
      const backfilled = { ...settings.keymap }
      for (const k of missingKeys) {
        backfilled[k] = DEFAULT_CONFIG.keymap[k]
      }
      patches.keymap = backfilled
    }
  }

  // Backfill missing status bar sections
  if (settings.statusBar) {
    const savedNames = new Set(settings.statusBar.sections.map((s) => s.name))
    const missing = DEFAULT_CONFIG.statusBar.sections.filter(
      (s) => !savedNames.has(s.name),
    )
    if (missing.length > 0) {
      patches.statusBar = {
        ...settings.statusBar,
        sections: [...settings.statusBar.sections, ...missing],
      }
    }
  }

  // Strip ngrok token, expose only a flag
  if (settings.ngrok) {
    patches.ngrok = {
      domain: settings.ngrok.domain,
      token: '',
      tokenPresent: !!settings.ngrok.token,
    }
  }

  return Object.keys(patches).length > 0
    ? { ...settings, ...patches }
    : settings
})

export const validateCertIp = publicProcedure.query(async () => {
  const certsDir = path.join(__dirname, '../../../../certs')
  const certPath = path.join(certsDir, 'cert.pem')

  if (!fs.existsSync(certPath)) {
    return { hasCert: false, certIps: [], localIp: '', match: false }
  }

  const certPem = fs.readFileSync(certPath, 'utf-8')
  const cert = new X509Certificate(certPem)

  const san = cert.subjectAltName || ''
  const certIps = san
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('IP Address:'))
    .map((s) => s.replace('IP Address:', ''))

  const localIp = await getLocalIp()
  const match = certIps.includes(localIp)

  return { hasCert: true, certIps, localIp, match }
})
