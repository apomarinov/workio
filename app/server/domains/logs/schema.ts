import { z } from 'zod'

// --- Row schemas ---

export const commandLogDataSchema = z.object({
  command: z.string(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  sshHost: z.string().optional(),
  terminalName: z.string().optional(),
  prName: z.string().optional(),
})

export const commandLogSchema = z.object({
  id: z.number(),
  terminal_id: z.number().nullable(),
  pr_id: z.string().nullable(),
  exit_code: z.number(),
  category: z.string(),
  data: commandLogDataSchema,
  created_at: z.string(),
})

export const logTerminalSchema = z.object({
  id: z.number(),
  name: z.string(),
  deleted: z.boolean(),
})

// --- Input schemas ---

export const listInput = z.object({
  terminalId: z.number().optional(),
  deleted: z.boolean().optional(),
  prName: z.string().optional(),
  category: z.string().optional(),
  failed: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  offset: z.number().min(0).default(0),
  limit: z.number().min(1).max(100).default(50),
})

// --- Types ---

export type CommandLog = z.infer<typeof commandLogSchema>
export type CommandLogData = z.infer<typeof commandLogDataSchema>
export type LogTerminal = z.infer<typeof logTerminalSchema>
export type ListInput = z.infer<typeof listInput>
