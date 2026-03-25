import pool from '@server/db'
import { DEFAULT_CONFIG, type SettingsUpdateInternal } from './schema'

export async function getSettings() {
  const { rows } = await pool.query<{
    id: number
    config: SettingsUpdateInternal
  }>('SELECT * FROM settings WHERE id = 1')

  if (rows.length === 0) {
    await pool.query('INSERT INTO settings (id, config) VALUES (1, $1)', [
      JSON.stringify(DEFAULT_CONFIG),
    ])
    return { id: 1, ...DEFAULT_CONFIG }
  }

  const config = rows[0].config
  return {
    id: rows[0].id,
    ...DEFAULT_CONFIG,
    ...config,
  }
}

export async function updateSettings(updates: SettingsUpdateInternal) {
  const current = await getSettings()
  const { id, ...currentConfig } = current
  const newConfig = { ...currentConfig, ...updates }

  await pool.query('UPDATE settings SET config = $1 WHERE id = $2', [
    JSON.stringify(newConfig),
    id,
  ])

  return { id, ...DEFAULT_CONFIG, ...newConfig }
}
