import { z } from 'zod'

// ── Shell integration schemas ────────────────────────────────────

const commandEventSchema = z.object({
  type: z.enum([
    'prompt',
    'command_start',
    'command_end',
    'done_marker',
    'remote_pid',
  ]),
  command: z.string().optional(),
  exitCode: z.number().optional(),
  remotePid: z.number().optional(),
})

export type CommandEvent = z.infer<typeof commandEventSchema>

export type CommandEventCallback = (event: CommandEvent) => void

// ── IPC schemas (runtime-validated at trust boundaries) ──────────

const workerInitConfigSchema = z.object({
  shellId: z.number(),
  terminalId: z.number(),
  cols: z.number(),
  rows: z.number(),
  sessionName: z.string(),
  shellName: z.string(),
  cwd: z.string().optional(),
  shell: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  sshHost: z.string().optional(),
  sshConfig: z
    .object({
      host: z.string(),
      hostname: z.string(),
      port: z.number(),
      user: z.string(),
      identityFile: z.string(),
    })
    .optional(),
  integrationScript: z.string().nullable().optional(),
  sshInlineScript: z.string().nullable().optional(),
})

export type WorkerInitConfig = z.infer<typeof workerInitConfigSchema>

export const masterToWorkerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('init'), config: workerInitConfigSchema }),
  z.object({ type: z.literal('write'), data: z.string() }),
  z.object({
    type: z.literal('resize'),
    cols: z.number(),
    rows: z.number(),
  }),
  z.object({ type: z.literal('kill') }),
  z.object({ type: z.literal('get-buffer'), requestId: z.string() }),
  z.object({ type: z.literal('set-pending-command'), command: z.string() }),
  z.object({ type: z.literal('interrupt') }),
  z.object({ type: z.literal('kill-children'), requestId: z.string() }),
  z.object({ type: z.literal('update-session-name'), name: z.string() }),
])

export type MasterToWorkerMessage = z.infer<typeof masterToWorkerMessageSchema>

export const workerToMasterMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), pid: z.number() }),
  z.object({ type: z.literal('data'), data: z.string() }),
  z.object({ type: z.literal('exit'), code: z.number() }),
  z.object({
    type: z.literal('command-event'),
    event: commandEventSchema,
  }),
  z.object({
    type: z.literal('bell'),
    shellId: z.number(),
    terminalId: z.number(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('buffer-response'),
    requestId: z.string(),
    buffer: z.array(z.string()),
  }),
  z.object({
    type: z.literal('kill-children-response'),
    requestId: z.string(),
    success: z.boolean(),
  }),
  z.object({
    type: z.literal('state-update'),
    isIdle: z.boolean(),
    currentCommand: z.string().nullable(),
  }),
  z.object({
    type: z.literal('log'),
    level: z.string(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
])

export type WorkerToMasterMessage = z.infer<typeof workerToMasterMessageSchema>

// ── Session types ────────────────────────────────────────────────

export type BellSubscription = {
  shellId: number
  terminalId: number
  command: string
  terminalName: string
}

// ── Process tree types ───────────────────────────────────────────

export type ZellijPaneProcess = {
  pid: number
  command: string
  isIdle: boolean
  terminalId?: number
}

export type RemoteProcessInfo = {
  pid: number
  ppid: number
  rss: number
  cpu: number
  comm: string
}

// ── Monitor types ────────────────────────────────────────────────

export type ActiveProcess = {
  pid: number
  name: string
  command: string
  terminalId?: number
  shellId?: number
  source?: 'direct' | 'zellij'
  isZellij?: boolean
  startedAt?: number
}

export type ResourceUsage = {
  rss: number
  cpu: number
  pidCount: number
}

export type HostResourceInfo = {
  systemMemory: number
  cpuCount: number
  systemCpu: number
  systemRss: number
}

export type PortForwardStatus = {
  remotePort: number
  localPort: number
  connected: boolean
  error?: string
}

export type ProcessesPayload = {
  terminalId?: number
  processes: ActiveProcess[]
  ports?: Record<string, number[]>
  shellPorts?: Record<string, number[]>
  resourceUsage?: Record<string, ResourceUsage>
  systemMemory?: number
  cpuCount?: number
  systemCpu?: number
  systemRss?: number
  hostResources?: Record<string, HostResourceInfo>
  portForwardStatus?: Record<string, PortForwardStatus[]>
}

// ── Shell client types ───────────────────────────────────────────

export type ShellClient = {
  device: string
  browser: string
  ip: string
  isPrimary?: boolean
}

export type ShellClientsPayload = {
  shellId: number
  clients: ShellClient[]
}

// ── WebSocket schemas (runtime-validated at trust boundaries) ────

type PtyDimensions = {
  isPrimary: boolean
  ptyCols: number
  ptyRows: number
  ptyFontSize?: number
}

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    shellId: z.number(),
    cols: z.number(),
    rows: z.number(),
    fontSize: z.number().nullable().optional(),
    requestPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('input'),
    data: z.string(),
  }),
  z.object({
    type: z.literal('resize'),
    cols: z.number(),
    rows: z.number(),
  }),
  z.object({
    type: z.literal('claim-primary'),
  }),
  z.object({
    type: z.literal('release-primary'),
  }),
])

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>

export type WsServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string; code?: string }
  | ({ type: 'ready' } & PtyDimensions)
  | ({ type: 'primary-changed' } & PtyDimensions)

// WebSocket client info (per-connection metadata)
export type WsClientInfo = {
  ip: string
  device: string
  browser: string
  cols: number
  rows: number
  fontSize: number
  activeShellId: number | null
}
