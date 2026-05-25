import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const daemonScript = path.join(projectRoot, 'monitor_daemon.py')
const pidPath = path.join(projectRoot, 'daemon.pid')
const sockPath = path.join(projectRoot, 'daemon.sock')

let daemonProcess: ChildProcess | null = null

function isPidAlive(pid: number): boolean {
  // Signal 0 doesn't deliver a signal — it only checks whether the process
  // exists. ESRCH = no such process; EPERM = exists but not signalable by us.
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function removePidFile() {
  try {
    fs.unlinkSync(pidPath)
  } catch {}
}

function killPreviousDaemon() {
  let stats: fs.Stats
  try {
    stats = fs.statSync(pidPath)
  } catch {
    return
  }

  // Pidfiles from before this boot point to recycled pids — kernel pid
  // namespace resets every reboot, so the number could be any process now.
  const bootTime = new Date(Date.now() - os.uptime() * 1000)
  if (stats.mtime < bootTime) {
    log.info('[daemon] Discarding pre-boot pidfile')
    removePidFile()
    return
  }

  let pid: number
  try {
    pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
  } catch {
    removePidFile()
    return
  }
  if (!Number.isFinite(pid) || pid <= 1 || pid === process.pid) {
    removePidFile()
    return
  }

  if (!isPidAlive(pid)) {
    removePidFile()
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
    log.info(`[daemon] Killed orphaned daemon pid=${pid}`)
  } catch (err) {
    log.error({ err, pid }, '[daemon] Failed to signal previous daemon')
  }
  removePidFile()
}

export function startDaemon() {
  killPreviousDaemon()

  daemonProcess = spawn('python3', [daemonScript], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  if (daemonProcess.pid) {
    try {
      fs.writeFileSync(pidPath, String(daemonProcess.pid))
    } catch (err) {
      log.error({ err }, '[daemon] Failed to write pidfile')
    }
  }

  daemonProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) log.info(`[daemon] ${msg}`)
  })
  daemonProcess.on('exit', (code) => {
    log.info(`[daemon] Monitor daemon exited with code ${code}`)
    daemonProcess = null
    removePidFile()
  })
}

export function stopDaemon() {
  if (daemonProcess) {
    daemonProcess.kill('SIGKILL')
    daemonProcess = null
  }
  removePidFile()
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
