import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import SSHConfig from 'ssh-config'

export interface ResolvedSSHConfig {
  host: string
  hostname: string
  user: string
  port: number
  identityFile: string
}

export interface SSHHostEntry {
  alias: string
  hostname: string
  user: string | null
}

export function listSSHHosts(): SSHHostEntry[] {
  const configPath = path.join(os.homedir(), '.ssh', 'config')

  if (!fs.existsSync(configPath)) {
    return []
  }

  let configText: string
  try {
    configText = fs.readFileSync(configPath, 'utf-8')
  } catch {
    return []
  }

  const config = SSHConfig.parse(configText)
  const hosts: SSHHostEntry[] = []

  for (const section of config) {
    if (
      'param' in section &&
      section.param === 'Host' &&
      section.value &&
      !String(section.value).includes('*')
    ) {
      const alias = String(section.value)
      const resolved = config.compute(alias)
      hosts.push({
        alias,
        hostname: (resolved.HostName as string) || alias,
        user: (resolved.User as string) || null,
      })
    }
  }

  return hosts
}

export function validateSSHHost(
  alias: string,
):
  | { valid: true; config: ResolvedSSHConfig }
  | { valid: false; error: string } {
  const configPath = path.join(os.homedir(), '.ssh', 'config')

  if (!fs.existsSync(configPath)) {
    return { valid: false, error: '~/.ssh/config does not exist' }
  }

  let configText: string
  try {
    configText = fs.readFileSync(configPath, 'utf-8')
  } catch {
    return { valid: false, error: 'Failed to read ~/.ssh/config' }
  }

  const config = SSHConfig.parse(configText)
  const resolved = config.compute(alias)

  if (!resolved.HostName) {
    return {
      valid: false,
      error: `SSH host "${alias}" not found in ~/.ssh/config`,
    }
  }

  if (!resolved.User) {
    return {
      valid: false,
      error: `SSH host "${alias}" is missing User field`,
    }
  }

  const identityFile = resolved.IdentityFile
  if (
    !identityFile ||
    (Array.isArray(identityFile) && identityFile.length === 0)
  ) {
    return {
      valid: false,
      error: `SSH host "${alias}" is missing IdentityFile field`,
    }
  }

  const idFile = Array.isArray(identityFile) ? identityFile[0] : identityFile
  const expandedIdFile = idFile.startsWith('~/')
    ? path.join(os.homedir(), idFile.slice(2))
    : idFile

  if (!fs.existsSync(expandedIdFile)) {
    return {
      valid: false,
      error: `Identity file not found: ${idFile}`,
    }
  }

  return {
    valid: true,
    config: {
      host: alias,
      hostname: resolved.HostName as string,
      user: resolved.User as string,
      port: resolved.Port ? parseInt(resolved.Port as string, 10) : 22,
      identityFile: expandedIdFile,
    },
  }
}
