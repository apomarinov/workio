import { z } from 'zod'

export const sessionBranchEntrySchema = z.object({
  branch: z.string(),
  repo: z.string(),
})

export const sessionDataSchema = z.object({
  branch: z.string().optional(),
  repo: z.string().optional(),
  branches: z.array(sessionBranchEntrySchema).optional(),
})

export const sessionStatusSchema = z.enum([
  'started',
  'active',
  'done',
  'ended',
  'permission_needed',
  'idle',
])

export const sessionSchema = z.object({
  session_id: z.string(),
  project_id: z.number(),
  terminal_id: z.number().nullable(),
  shell_id: z.number().nullable(),
  name: z.string().nullable(),
  message_count: z.number().nullable(),
  status: sessionStatusSchema,
  transcript_path: z.string().nullable(),
  data: sessionDataSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const sessionWithProjectSchema = sessionSchema.extend({
  project_path: z.string(),
  latest_user_message: z.string().nullable(),
  latest_agent_message: z.string().nullable(),
  is_favorite: z.boolean(),
})

// --- Input schemas ---

export const updateSessionInput = z.object({
  id: z.string(),
  name: z.string().optional(),
})

export const deleteSessionInput = z.object({
  id: z.string(),
})

export const bulkDeleteSessionsInput = z.object({
  ids: z.array(z.string()).min(1),
})

export const toggleFavoriteInput = z.object({
  id: z.string(),
})

export const cleanupSessionsInput = z.object({
  weeks: z.number().min(1),
})

export const getByIdInput = z.object({
  id: z.string(),
})

// --- Types ---

export type SessionBranchEntry = z.infer<typeof sessionBranchEntrySchema>
export type SessionData = z.infer<typeof sessionDataSchema>
export type SessionStatus = z.infer<typeof sessionStatusSchema>
export type Session = z.infer<typeof sessionSchema>
export type SessionWithProject = z.infer<typeof sessionWithProjectSchema>
export type UpdateSessionInput = z.infer<typeof updateSessionInput>
export type DeleteSessionInput = z.infer<typeof deleteSessionInput>
export type BulkDeleteSessionsInput = z.infer<typeof bulkDeleteSessionsInput>
export type ToggleFavoriteInput = z.infer<typeof toggleFavoriteInput>
export type CleanupSessionsInput = z.infer<typeof cleanupSessionsInput>
