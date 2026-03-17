import { z } from 'zod'

// --- Row schemas ---

export const notificationDataSchema = z.object({
  // Auth fields
  attempts: z.number().optional(),
  // PR fields
  prTitle: z.string().optional(),
  prUrl: z.string().optional(),
  prNumber: z.number().optional(),
  reviewer: z.string().optional(),
  approver: z.string().optional(),
  author: z.string().optional(),
  body: z.string().optional(),
  commentUrl: z.string().optional(),
  commentId: z.number().optional(),
  checkName: z.string().optional(),
  checkUrl: z.string().optional(),
  state: z.string().optional(),
  reviewId: z.number().optional(),
  // Workspace fields
  terminalId: z.number().optional(),
  name: z.string().optional(),
  deleted: z.boolean().optional(),
  git_repo: z.record(z.string(), z.unknown()).optional(),
  setup: z.record(z.string(), z.unknown()).optional(),
})

export const notificationSchema = z.object({
  id: z.number(),
  dedup_hash: z.string().nullable(),
  type: z.string(),
  repo: z.string().nullable(),
  read: z.boolean(),
  created_at: z.string(),
  data: notificationDataSchema,
})

export const unreadPRNotificationSchema = z.object({
  repo: z.string(),
  prNumber: z.number(),
  count: z.number(),
  items: z.array(
    z.object({
      commentId: z.number().optional(),
      reviewId: z.number().optional(),
    }),
  ),
})

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

// --- Types ---

export type Notification = z.infer<typeof notificationSchema>
export type NotificationData = z.infer<typeof notificationDataSchema>
export type UnreadPRNotification = z.infer<typeof unreadPRNotificationSchema>
export type PushSubscribeInput = z.infer<typeof pushSubscribeInput>
