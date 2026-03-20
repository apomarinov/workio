import { z } from 'zod'

// --- Row schema ---

export const shellSchema = z.object({
  id: z.number(),
  terminal_id: z.number(),
  name: z.string(),
  active_cmd: z.string().nullable(),
  created_at: z.string(),
})

// --- Input schemas ---

export const createShellInput = z.object({
  terminalId: z.number(),
  name: z.string().optional(),
})

export const shellIdInput = z.object({
  id: z.number(),
})

export const renameShellInput = z.object({
  id: z.number(),
  name: z.string(),
})

export const writeShellInput = z.object({
  id: z.number(),
  data: z.string(),
  pending: z.boolean().optional(),
})

// --- Types ---

export type Shell = z.infer<typeof shellSchema>
