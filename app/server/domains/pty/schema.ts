import { z } from 'zod'
import type { PermissionOption, PermissionPromptType } from '@/types'

// ── Shell integration schemas ───────────────────────────────────────

export const commandEventSchema = z.object({
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

// ── IPC schemas ─────────────────────────────────────────────────────

const sshConfigSchema = z.object({
  host: z.string(),
  hostname: z.string(),
  port: z.number(),
  user: z.string(),
  identityFile: z.string(),
})

export const workerInitConfigSchema = z.object({
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
  sshConfig: sshConfigSchema.optional(),
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
  z.object({ type: z.literal('command-event'), event: commandEventSchema }),
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

// ── Session schemas ─────────────────────────────────────────────────

export const bellSubscriptionSchema = z.object({
  shellId: z.number(),
  terminalId: z.number(),
  command: z.string(),
  terminalName: z.string(),
})

export type BellSubscription = z.infer<typeof bellSubscriptionSchema>

// ── Permission scanner schemas ──────────────────────────────────────

export const parsedPermissionPromptSchema = z.object({
  type: z.custom<PermissionPromptType>(),
  title: z.string(),
  question: z.string(),
  context: z.string(),
  options: z.array(z.custom<PermissionOption>()),
})

export type ParsedPermissionPrompt = z.infer<
  typeof parsedPermissionPromptSchema
>

// ── Process tree schemas ────────────────────────────────────────────

export const zellijPaneProcessSchema = z.object({
  pid: z.number(),
  command: z.string(),
  isIdle: z.boolean(),
  terminalId: z.number().optional(),
})

export type ZellijPaneProcess = z.infer<typeof zellijPaneProcessSchema>

export const remoteProcessInfoSchema = z.object({
  pid: z.number(),
  ppid: z.number(),
  rss: z.number(),
  cpu: z.number(),
  comm: z.string(),
})

export type RemoteProcessInfo = z.infer<typeof remoteProcessInfoSchema>

// ── Monitor schemas ────────────────────────────────────────────────

export const activeProcessSchema = z.object({
  pid: z.number(),
  name: z.string(),
  command: z.string(),
  terminalId: z.number().optional(),
  shellId: z.number().optional(),
  source: z.enum(['direct', 'zellij']).optional(),
  isZellij: z.boolean().optional(),
  startedAt: z.number().optional(),
})

export type ActiveProcess = z.infer<typeof activeProcessSchema>

export const resourceUsageSchema = z.object({
  rss: z.number(),
  cpu: z.number(),
  pidCount: z.number(),
})

export type ResourceUsage = z.infer<typeof resourceUsageSchema>

export const hostResourceInfoSchema = z.object({
  systemMemory: z.number(),
  cpuCount: z.number(),
  systemCpu: z.number(),
  systemRss: z.number(),
})

export type HostResourceInfo = z.infer<typeof hostResourceInfoSchema>

export const portForwardStatusSchema = z.object({
  remotePort: z.number(),
  localPort: z.number(),
  connected: z.boolean(),
  error: z.string().optional(),
})

export type PortForwardStatus = z.infer<typeof portForwardStatusSchema>

export const processesPayloadSchema = z.object({
  terminalId: z.number().optional(),
  processes: z.array(activeProcessSchema),
  ports: z.record(z.string(), z.array(z.number())).optional(),
  shellPorts: z.record(z.string(), z.array(z.number())).optional(),
  resourceUsage: z.record(z.string(), resourceUsageSchema).optional(),
  systemMemory: z.number().optional(),
  cpuCount: z.number().optional(),
  systemCpu: z.number().optional(),
  systemRss: z.number().optional(),
  hostResources: z.record(z.string(), hostResourceInfoSchema).optional(),
  portForwardStatus: z
    .record(z.string(), z.array(portForwardStatusSchema))
    .optional(),
})

export type ProcessesPayload = z.infer<typeof processesPayloadSchema>

export const gitDiffStatSchema = z.object({
  added: z.number(),
  removed: z.number(),
  untracked: z.number(),
  untrackedLines: z.number(),
})

export type GitDiffStat = z.infer<typeof gitDiffStatSchema>

export const gitLastCommitSchema = z.object({
  hash: z.string(),
  author: z.string(),
  date: z.string(),
  subject: z.string(),
  isLocal: z.boolean(),
})

export type GitLastCommit = z.infer<typeof gitLastCommitSchema>

export const gitDirtyPayloadSchema = z.object({
  dirtyStatus: z.record(z.string(), gitDiffStatSchema),
  lastCommit: z.record(z.string(), gitLastCommitSchema).optional(),
})

export type GitDirtyPayload = z.infer<typeof gitDirtyPayloadSchema>

export const gitRemoteSyncStatSchema = z.object({
  behind: z.number(),
  ahead: z.number(),
  noRemote: z.boolean(),
})

export type GitRemoteSyncStat = z.infer<typeof gitRemoteSyncStatSchema>

export const gitRemoteSyncPayloadSchema = z.object({
  syncStatus: z.record(z.string(), gitRemoteSyncStatSchema),
})

export type GitRemoteSyncPayload = z.infer<typeof gitRemoteSyncPayloadSchema>
