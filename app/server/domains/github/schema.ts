import { z } from 'zod'

// --- PR data types ---

export interface FailedPRCheck {
  name: string
  status: string
  conclusion: string
  detailsUrl: string
  startedAt: string
}

export interface PRReaction {
  content: string
  count: number
  viewerHasReacted: boolean
  users: string[]
}

export interface PRComment {
  id?: number
  url?: string
  author: string
  avatarUrl: string
  body: string
  createdAt: string
  path?: string
  isUnread?: boolean
  reactions?: PRReaction[]
}

export interface PRReview {
  id?: number
  url?: string
  author: string
  avatarUrl: string
  state: string
  body: string
  submittedAt?: string
  isUnread?: boolean
  reactions?: PRReaction[]
}

export interface PRReviewThread {
  path: string
  comments: PRComment[]
}

export type PRDiscussionItem =
  | { type: 'review'; review: PRReview; threads: PRReviewThread[] }
  | { type: 'comment'; comment: PRComment }
  | { type: 'thread'; thread: PRReviewThread }

export interface PRCheckStatus {
  prNumber: number
  prTitle: string
  prUrl: string
  prBody: string
  branch: string
  baseBranch: string
  repo: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  reviews: PRReview[]
  checks: FailedPRCheck[]
  comments: PRComment[]
  discussion: PRDiscussionItem[]
  createdAt: string
  updatedAt: string
  areAllChecksOk: boolean
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  isMerged: boolean
  isApproved: boolean
  hasChangesRequested: boolean
  hasConflicts: boolean
  hasPendingReviews: boolean
  hasFailedChecks: boolean
  runningChecksCount: number
  failedChecksCount: number
  headCommitSha: string
  isDraft: boolean
  hasUnreadNotifications?: boolean
}

export interface PRChecksPayload {
  prs: PRCheckStatus[]
  username: string | null
}

export interface MergedPRSummary {
  prNumber: number
  prTitle: string
  prUrl: string
  branch: string
  repo: string
  state: 'MERGED' | 'CLOSED'
}

export interface InvolvedPRSummary {
  prNumber: number
  prTitle: string
  prUrl: string
  repo: string
  author: string
  involvement: 'review-requested' | 'mentioned'
}

export const WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
] as const

// --- Input schemas ---

export const reposInput = z.object({
  q: z.string().optional(),
})

export const conductorInput = z.object({
  repo: z.string(),
})

export const closedPRsInput = z.object({
  repos: z.array(z.string()),
  limit: z.number().min(1).max(100).default(20),
})

export const involvedPRsInput = z.object({
  repos: z.array(z.string()),
  limit: z.number().min(1).max(100).default(30),
})

export const prCommentsInput = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  excludeAuthors: z.array(z.string()).optional(),
})

export const prParamsInput = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number(),
})

export const requestReviewInput = prParamsInput.extend({
  reviewer: z.string(),
})

export const mergeInput = prParamsInput.extend({
  method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
})

export const renameInput = prParamsInput.extend({
  title: z.string().min(1),
})

export const editInput = prParamsInput.extend({
  title: z.string().min(1),
  body: z.string(),
  draft: z.boolean().optional(),
})

export const createPRInput = z.object({
  owner: z.string(),
  repo: z.string(),
  head: z.string(),
  base: z.string(),
  title: z.string().min(1),
  body: z.string(),
  draft: z.boolean(),
})

export const commentInput = prParamsInput.extend({
  body: z.string().min(1),
})

export const replyToCommentInput = prParamsInput.extend({
  commentId: z.number(),
  body: z.string().min(1),
})

export const editCommentInput = prParamsInput.extend({
  commentId: z.number(),
  body: z.string().min(1),
  type: z.enum(['issue_comment', 'review_comment', 'review']),
})

export const reactionInput = z.object({
  owner: z.string(),
  repo: z.string(),
  subjectId: z.number(),
  subjectType: z.enum(['issue_comment', 'review_comment', 'review']),
  content: z.string(),
  prNumber: z.number().optional(),
})

export const rerunCheckInput = prParamsInput.extend({
  checkUrl: z.string(),
})

export const rerunAllChecksInput = prParamsInput.extend({
  checkUrls: z.array(z.string()).min(1),
})

export const webhookRepoInput = z.object({
  owner: z.string(),
  repo: z.string(),
})

// --- Webhook payload schema ---

export const webhookPayloadSchema = z.object({
  repository: z.object({ full_name: z.string().optional() }).optional(),
  action: z.string().optional(),
  pull_request: z
    .object({
      number: z.number(),
      title: z.string(),
      body: z.string().optional(),
      draft: z.boolean().optional(),
      head: z.object({ ref: z.string() }).optional(),
      base: z.object({ ref: z.string() }).optional(),
      html_url: z.string(),
      state: z.string(),
      merged: z.boolean().optional(),
      mergeable: z.boolean().nullable().optional(),
      mergeable_state: z.string().optional(),
      created_at: z.string(),
      updated_at: z.string(),
      user: z.object({ login: z.string().optional() }).optional(),
    })
    .optional(),
  review: z
    .object({
      id: z.number(),
      html_url: z.string().optional(),
      user: z.object({ login: z.string() }),
      state: z.string(),
      body: z.string().nullable(),
      submitted_at: z.string(),
    })
    .optional(),
  comment: z
    .object({
      id: z.number(),
      html_url: z.string(),
      user: z.object({ login: z.string() }),
      body: z.string(),
      created_at: z.string(),
      path: z.string().optional(),
      pull_request_review_id: z.number().optional(),
      in_reply_to_id: z.number().optional(),
    })
    .optional(),
  issue: z
    .object({
      number: z.number(),
      user: z.object({ login: z.string().optional() }).optional(),
      pull_request: z.object({ url: z.string() }).optional(),
    })
    .optional(),
  requested_reviewer: z.object({ login: z.string() }).optional(),
})

// --- Types ---

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>
