import type { Settings } from '../../../src/types'
import pool from '../../db'
import { DEFAULT_CONFIG } from './schema'

export async function getSettings(): Promise<Settings> {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1')

  if (rows.length === 0) {
    await pool.query('INSERT INTO settings (id, config) VALUES (1, $1)', [
      JSON.stringify(DEFAULT_CONFIG),
    ])
    return { id: 1, ...DEFAULT_CONFIG }
  }

  const config = rows[0].config as Partial<typeof DEFAULT_CONFIG>
  return {
    id: rows[0].id,
    ...DEFAULT_CONFIG,
    ...config,
  }
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id'>>,
): Promise<Settings> {
  const current = await getSettings()
  const { id: _, ...currentConfig } = current
  const newConfig = { ...currentConfig, ...updates }

  await pool.query('UPDATE settings SET config = $1 WHERE id = 1', [
    JSON.stringify(newConfig),
  ])

  return { id: 1, ...DEFAULT_CONFIG, ...newConfig }
}

export async function getOrCreateVapidKeys(): Promise<{
  publicKey: string
  privateKey: string
}> {
  const settings = await getSettings()
  if (settings.vapid_public_key && settings.vapid_private_key) {
    return {
      publicKey: settings.vapid_public_key,
      privateKey: settings.vapid_private_key,
    }
  }
  const webPush = await import('web-push')
  const keys = webPush.default.generateVAPIDKeys()
  await updateSettings({
    vapid_public_key: keys.publicKey,
    vapid_private_key: keys.privateKey,
  })
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}
