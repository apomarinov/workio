import fs from 'node:fs'
import { Client } from 'ssh2'
import { validateSSHHost } from './config'

const EXEC_TIMEOUT = 15_000

export function execSSHCommand(
  sshHost: string,
  command: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
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
      reject(new Error(`SSH command timed out after ${EXEC_TIMEOUT}ms`))
    }, EXEC_TIMEOUT)

    conn.on('ready', () => {
      const fullCommand = cwd ? `cd ${cwd} && ${command}` : command

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
