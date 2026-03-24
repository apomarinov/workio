import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const daemonScript = path.join(projectRoot, 'monitor_daemon.py')

let daemonProcess: ChildProcess | null = null

export function startDaemon() {
  daemonProcess = spawn('python3', [daemonScript], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  daemonProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.info(`[daemon] ${msg}`)
  })
  daemonProcess.on('exit', (code) => {
    log.info(`[daemon] Monitor daemon exited with code ${code}`)
    daemonProcess = null
  })
}

export function stopDaemon() {
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM')
    daemonProcess = null
  }
  // Clean up socket file
  const sockPath = path.join(projectRoot, 'daemon.sock')
  try {
    fs.unlinkSync(sockPath)
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      log.error({ err }, '[daemon] Failed to clean up socket file')
    }
  }
}
