import type { CommandEvent } from './osc-parser'

// ── Worker init config ──────────────────────────────────────────────

export interface WorkerInitConfig {
  shellId: number
  terminalId: number
  cols: number
  rows: number
  sessionName: string
  shellName: string
  // Local terminal fields
  cwd?: string
  shell?: string
  env?: Record<string, string>
  // SSH terminal fields
  sshHost?: string
  sshConfig?: {
    host: string
    hostname: string
    port: number
    user: string
    identityFile: string
  }
  // Shell integration
  integrationScript?: string | null
  sshInlineScript?: string | null
}

// ── Master → Worker messages ────────────────────────────────────────

export type MasterToWorkerMessage =
  | { type: 'init'; config: WorkerInitConfig }
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' }
  | { type: 'get-buffer'; requestId: string }
  | { type: 'set-pending-command'; command: string }
  | { type: 'interrupt' }
  | { type: 'kill-children'; requestId: string }
  | { type: 'update-session-name'; name: string }

// ── Worker → Master messages ────────────────────────────────────────

export type WorkerToMasterMessage =
  | { type: 'ready'; pid: number }
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'command-event'; event: CommandEvent }
  | { type: 'bell'; shellId: number; terminalId: number }
  | { type: 'error'; message: string }
  | { type: 'buffer-response'; requestId: string; buffer: string[] }
  | {
      type: 'kill-children-response'
      requestId: string
      success: boolean
    }
  | {
      type: 'state-update'
      isIdle: boolean
      currentCommand: string | null
    }
  | { type: 'log'; level: string; message: string; data?: object }
