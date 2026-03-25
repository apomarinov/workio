import { z } from 'zod'

// --- Row types ---

export interface NotificationData {
  // Auth fields
  attempts?: number
  // PR fields
  prTitle?: string
  prUrl?: string
  prNumber?: number
  reviewer?: string
  approver?: string
  author?: string
  body?: string
  commentUrl?: string
  commentId?: number
  checkName?: string
  checkUrl?: string
  state?: string
  reviewId?: number
  // Workspace fields
  terminalId?: number
  name?: string
  deleted?: boolean
  git_repo?: Record<string, unknown>
  setup?: Record<string, unknown>
}

export interface Notification {
  id: number
  dedup_hash: string | null
  type: string
  repo: string | null
  read: boolean
  created_at: string
  data: NotificationData
}

// --- Input schemas ---

export const listInput = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
})

export const sendCustomInput = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  terminalId: z.number().optional(),
  shellId: z.number().optional(),
})

export const markPRReadInput = z.object({
  repo: z.string(),
  prNumber: z.number(),
})

export const markItemReadInput = z.object({
  repo: z.string(),
  prNumber: z.number(),
  commentId: z.number().optional(),
  reviewId: z.number().optional(),
})

export const idInput = z.object({
  id: z.number(),
})

export const pushSubscribeInput = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  userAgent: z.string().optional(),
})

export const pushUnsubscribeInput = z.object({
  endpoint: z.string(),
})
