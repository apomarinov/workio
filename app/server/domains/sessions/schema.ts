import { z } from 'zod'

// --- Data types ---

export type SessionBranchEntry = {
  branch: string
  repo: string
}

export type SessionData = {
  branch?: string
  repo?: string
  branches?: SessionBranchEntry[]
}

export type SessionStatus =
  | 'started'
  | 'active'
  | 'done'
  | 'ended'
  | 'permission_needed'
  | 'idle'

export type Session = {
  session_id: string
  project_id: number
  terminal_id: number | null
  shell_id: number | null
  name: string | null
  message_count: number | null
  status: SessionStatus
  transcript_path: string | null
  data: SessionData | null
  created_at: string
  updated_at: string
}

export type SessionWithProject = Session & {
  project_path: string
  latest_user_message: string | null
  latest_agent_message: string | null
  is_favorite: boolean
}

export type SessionMessage = {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  todo_id: string | null
  body: string | null
  tools: Record<string, unknown> | null
  images: unknown[] | null
  created_at: string
  updated_at: string | null
  prompt_text: string | null
}

export type SearchMatchMessage = {
  id: number
  body: string
  is_user: boolean
}

export type SessionSearchMatch = {
  session_id: string
  name: string | null
  terminal_name: string | null
  project_path: string
  status: string
  updated_at: string
  data: SessionData | null
  messages: SearchMatchMessage[]
}

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

export const getSessionMessagesInput = z.object({
  id: z.string(),
  limit: z.number().min(1).max(10000).default(30),
  offset: z.number().min(0).default(0),
})

export const searchSessionMessagesInput = z.object({
  q: z.string().nullable(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  recentOnly: z.boolean().default(true),
})

export const backfillCheckInput = z.object({
  weeksBack: z.number().min(1).default(4),
})

export const backfillRunInput = z.object({
  encodedPath: z.string(),
  cwd: z.string(),
  terminalId: z.number(),
  shellId: z.number(),
  weeksBack: z.number().min(1),
})

export const moveTargetsInput = z.object({
  id: z.string(),
})

export const moveSessionInput = z.object({
  id: z.string(),
  targetProjectPath: z.string(),
  targetTerminalId: z.number(),
})
