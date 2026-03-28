import serverEvents from '@server/lib/events'
import { getSettings } from './db'
import { DEFAULT_CONFIG, type ServerConfig } from './schema'

type ServerConfigKey = keyof ServerConfig

let serverConfig: ServerConfig = { ...DEFAULT_CONFIG.server_config }

export async function loadServerConfig() {
  const settings = await getSettings()
  serverConfig = { ...DEFAULT_CONFIG.server_config, ...settings.server_config }
}

export function getServerConfig<K extends ServerConfigKey>(
  key: K,
): ServerConfig[K] {
  return serverConfig[key]
}

export function applyServerConfig(changes: Partial<ServerConfig>) {
  Object.assign(serverConfig, changes)
  serverEvents.emit('settings:server-config-changed', changes)
}
