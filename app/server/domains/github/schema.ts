import { z } from 'zod'

// --- PR data schemas ---

export const failedPRCheckSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string(),
  detailsUrl: z.string(),
  startedAt: z.string(),
})

export const prReactionSchema = z.object({
  content: z.string(),
  count: z.number(),
  viewerHasReacted: z.boolean(),
  users: z.array(z.string()),
})

export const prCommentSchema = z.object({
  id: z.number().optional(),
  url: z.string().optional(),
  author: z.string(),
  avatarUrl: z.string(),
  body: z.string(),
  createdAt: z.string(),
  path: z.string().optional(),
  isUnread: z.boolean().optional(),
  reactions: z.array(prReactionSchema).optional(),
})

export const prReviewSchema = z.object({
  id: z.number().optional(),
  url: z.string().optional(),
  author: z.string(),
  avatarUrl: z.string(),
  state: z.string(),
  body: z.string(),
  submittedAt: z.string().optional(),
  isUnread: z.boolean().optional(),
  reactions: z.array(prReactionSchema).optional(),
})

export const prReviewThreadSchema = z.object({
  path: z.string(),
  comments: z.array(prCommentSchema),
})

export const prDiscussionItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('review'),
    review: prReviewSchema,
    threads: z.array(prReviewThreadSchema),
  }),
  z.object({ type: z.literal('comment'), comment: prCommentSchema }),
  z.object({ type: z.literal('thread'), thread: prReviewThreadSchema }),
])

export const prCheckStatusSchema = z.object({
  prNumber: z.number(),
  prTitle: z.string(),
  prUrl: z.string(),
  prBody: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  repo: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  reviewDecision: z.enum([
    'APPROVED',
    'CHANGES_REQUESTED',
    'REVIEW_REQUIRED',
    '',
  ]),
  reviews: z.array(prReviewSchema),
  checks: z.array(failedPRCheckSchema),
  comments: z.array(prCommentSchema),
  discussion: z.array(prDiscussionItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  areAllChecksOk: z.boolean(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']).optional(),
  isMerged: z.boolean(),
  isApproved: z.boolean(),
  hasChangesRequested: z.boolean(),
  hasConflicts: z.boolean(),
  hasPendingReviews: z.boolean(),
  hasFailedChecks: z.boolean(),
  runningChecksCount: z.number(),
  failedChecksCount: z.number(),
  headCommitSha: z.string(),
  isDraft: z.boolean(),
  hasUnreadNotifications: z.boolean().optional(),
})

export const prChecksPayloadSchema = z.object({
  prs: z.array(prCheckStatusSchema),
  username: z.string().nullable(),
})

export const mergedPRSummarySchema = z.object({
  prNumber: z.number(),
  prTitle: z.string(),
  prUrl: z.string(),
  branch: z.string(),
  repo: z.string(),
  state: z.enum(['MERGED', 'CLOSED']),
})

export const involvedPRSummarySchema = z.object({
  prNumber: z.number(),
  prTitle: z.string(),
  prUrl: z.string(),
  repo: z.string(),
  author: z.string(),
  involvement: z.enum(['review-requested', 'mentioned']),
})

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
      body: z.string(),
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

export type FailedPRCheck = z.infer<typeof failedPRCheckSchema>
export type PRReaction = z.infer<typeof prReactionSchema>
export type PRComment = z.infer<typeof prCommentSchema>
export type PRReview = z.infer<typeof prReviewSchema>
export type PRReviewThread = z.infer<typeof prReviewThreadSchema>
export type PRDiscussionItem = z.infer<typeof prDiscussionItemSchema>
export type PRCheckStatus = z.infer<typeof prCheckStatusSchema>
export type PRChecksPayload = z.infer<typeof prChecksPayloadSchema>
export type MergedPRSummary = z.infer<typeof mergedPRSummarySchema>
export type InvolvedPRSummary = z.infer<typeof involvedPRSummarySchema>
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>
