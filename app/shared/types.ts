export interface ActiveProcess {
  pid: number
  name: string
  command: string
  terminalId?: number
  source?: 'direct' | 'zellij'
  isZellij?: boolean
}

export interface ProcessesPayload {
  terminalId?: number
  processes: ActiveProcess[]
  ports?: Record<number, number[]>
}

export interface FailedPRCheck {
  name: string
  status: string
  conclusion: string
  detailsUrl: string
  startedAt: string
}

export interface PRComment {
  id?: number
  url?: string
  author: string
  avatarUrl: string
  body: string
  createdAt: string
  path?: string // File path for code review comments
  isUnread?: boolean
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
  // Pre-computed status flags
  isMerged: boolean
  isApproved: boolean
  hasChangesRequested: boolean
  hasConflicts: boolean
  hasPendingReviews: boolean
  hasFailedChecks: boolean
  runningChecksCount: number
  failedChecksCount: number
  headCommitSha: string
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

export interface GitDiffStat {
  added: number
  removed: number
  untracked: number
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface ChangedFile {
  path: string
  status: FileStatus
  added: number
  removed: number
  oldPath?: string
}

export interface GitDirtyPayload {
  dirtyStatus: Record<number, GitDiffStat> // terminalId -> line diff stats
}

export interface GitRemoteSyncStat {
  behind: number
  ahead: number
  noRemote: boolean
}

export interface GitRemoteSyncPayload {
  syncStatus: Record<number, GitRemoteSyncStat> // terminalId -> remote sync stats
}

export interface WorkspacePayload {
  terminalId: number
  name: string
  git_repo?: {
    repo: string
    status: 'setup' | 'done' | 'failed'
    workspaces_root?: string
    error?: string
  }
  setup?: {
    conductor?: boolean
    setup?: string
    delete?: string
    status: 'setup' | 'delete' | 'done' | 'failed'
    error?: string
  }
  deleted?: boolean
}

export interface UnreadPRNotification {
  repo: string
  prNumber: number
  count: number
  items: { commentId?: number; reviewId?: number }[]
}

// GitHub webhook events we subscribe to
export const WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
] as const
