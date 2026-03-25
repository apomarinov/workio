import { z } from 'zod'

// --- Row types ---

export interface CommandLogData {
  command: string
  stdout?: string
  stderr?: string
  sshHost?: string
  terminalName?: string
  prName?: string
}

export interface CommandLog {
  id: number
  terminal_id: number | null
  pr_id: string | null
  exit_code: number
  category: string
  data: CommandLogData
  created_at: string
}

export interface LogTerminal {
  id: number
  name: string
  deleted: boolean
}

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

export type ListInput = z.infer<typeof listInput>
