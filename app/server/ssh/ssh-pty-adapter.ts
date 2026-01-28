import fs from 'node:fs'
import { Client, type ClientChannel } from 'ssh2'
import type { ResolvedSSHConfig } from './config'

export interface TerminalBackend {
  readonly pid: number
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
  onData(callback: (data: string) => void): { dispose(): void }
  onExit(callback: (e: { exitCode: number; signal?: number }) => void): {
    dispose(): void
  }
}

export function createSSHSession(
  config: ResolvedSSHConfig,
  cols: number,
  rows: number,
): Promise<TerminalBackend> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    conn.on('ready', () => {
      conn.shell(
        {
          term: 'xterm-256color',
          cols,
          rows,
        },
        (err: Error | undefined, channel: ClientChannel) => {
          if (err) {
            conn.end()
            return reject(err)
          }

          let exited = false

          const adapter: TerminalBackend = {
            pid: 0,

            write(data: string) {
              if (!exited) {
                channel.write(data)
              }
            },

            resize(columns: number, newRows: number) {
              if (!exited) {
                channel.setWindow(newRows, columns, 480, 640)
              }
            },

            kill(_signal?: string) {
              exited = true
              try {
                channel.close()
              } catch {
                // Already closed
              }
              try {
                conn.end()
              } catch {
                // Already ended
              }
            },

            onData(callback: (data: string) => void) {
              const handler = (data: Buffer) => {
                callback(data.toString('utf-8'))
              }
              channel.on('data', handler)
              channel.stderr.on('data', handler)
              return {
                dispose: () => {
                  channel.removeListener('data', handler)
                },
              }
            },

            onExit(
              callback: (e: { exitCode: number; signal?: number }) => void,
            ) {
              const onClose = () => {
                if (!exited) {
                  exited = true
                  callback({ exitCode: 0 })
                  conn.end()
                }
              }

              channel.on('close', onClose)
              channel.on('exit', (code: number | null) => {
                if (!exited) {
                  exited = true
                  callback({ exitCode: code ?? 0 })
                }
              })
              conn.on('end', () => {
                if (!exited) {
                  exited = true
                  callback({ exitCode: 0 })
                }
              })
              conn.on('error', () => {
                if (!exited) {
                  exited = true
                  callback({ exitCode: 1 })
                }
              })

              return { dispose: () => {} }
            },
          }

          resolve(adapter)
        },
      )
    })

    conn.on('error', (err: Error) => {
      reject(err)
    })

    const privateKey = fs.readFileSync(config.identityFile)
    conn.connect({
      host: config.hostname,
      port: config.port,
      username: config.user,
      privateKey,
      readyTimeout: 10000,
      // Fallback to SSH agent if key doesn't work
      agent: process.env.SSH_AUTH_SOCK,
    })
  })
}
