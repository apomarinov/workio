import fs from 'node:fs'
import { Client } from 'ssh2'
import { validateSSHHost } from './config'

const DEFAULT_TIMEOUT = 15_000

export interface ExecSSHOptions {
  cwd?: string
  timeout?: number // ms, defaults to 15_000
}

export function execSSHCommand(
  sshHost: string,
  command: string,
  options?: string | ExecSSHOptions,
): Promise<{ stdout: string; stderr: string }> {
  const cwd = typeof options === 'string' ? options : options?.cwd
  const timeout =
    (typeof options === 'object' ? options?.timeout : undefined) ??
    DEFAULT_TIMEOUT

  return new Promise((resolve, reject) => {
    const result = validateSSHHost(sshHost)
    if (!result.valid) {
      return reject(
        new Error(`SSH validation failed for ${sshHost}: ${result.error}`),
      )
    }

    const conn = new Client()
    const timer = setTimeout(() => {
      conn.end()
      reject(new Error(`SSH command timed out after ${timeout}ms`))
    }, timeout)

    conn.on('ready', () => {
      let fullCommand = command
      if (cwd) {
        // Handle tilde expansion - don't quote the ~ part
        if (cwd.startsWith('~/')) {
          const rest = cwd.slice(2).replace(/'/g, "'\\''")
          fullCommand = `cd ~/'${rest}' && ${command}`
        } else if (cwd === '~') {
          fullCommand = `cd ~ && ${command}`
        } else {
          fullCommand = `cd '${cwd.replace(/'/g, "'\\''")}' && ${command}`
        }
      }

      conn.exec(fullCommand, (err, channel) => {
        if (err) {
          clearTimeout(timer)
          conn.end()
          return reject(err)
        }

        let stdout = ''
        let stderr = ''

        channel.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8')
        })

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8')
        })

        channel.on('close', (code: number | null) => {
          clearTimeout(timer)
          conn.end()
          if (code !== 0) {
            const error = new Error(
              `SSH command exited with code ${code}: ${stderr.trim()}`,
            )
            ;(error as Error & { code: number | null }).code = code
            return reject(error)
          }
          resolve({ stdout, stderr })
        })
      })
    })

    conn.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
    })

    const privateKey = fs.readFileSync(result.config.identityFile)
    conn.connect({
      host: result.config.hostname,
      port: result.config.port,
      username: result.config.user,
      privateKey,
      readyTimeout: 10_000,
      agent: process.env.SSH_AUTH_SOCK,
    })
  })
}
