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
