export interface ActiveProcess {
  pid: number
  name: string
  command: string
  terminalId?: number
  shellId?: number
  source?: 'direct' | 'zellij'
  isZellij?: boolean
  startedAt?: number
}

export interface ResourceUsage {
  rss: number
  cpu: number
  pidCount: number
}

export interface HostResourceInfo {
  systemMemory: number // total RAM in bytes
  cpuCount: number // logical CPU cores
  systemCpu: number // total CPU usage (sum of all %cpu)
  systemRss: number // total RSS in KB
}

export interface PortForwardStatus {
  remotePort: number
  localPort: number
  connected: boolean
  error?: string
}

export interface ProcessesPayload {
  terminalId?: number
  processes: ActiveProcess[]
  ports?: Record<number, number[]>
  shellPorts?: Record<number, number[]>
  resourceUsage?: Record<number, ResourceUsage>
  systemMemory?: number // total system RAM in bytes (os.totalmem)
  cpuCount?: number // number of logical CPU cores (os.cpus().length)
  systemCpu?: number // total system CPU usage (sum of all %cpu)
  systemRss?: number // total system RSS in KB
  hostResources?: Record<string, HostResourceInfo> // sshHost -> system totals
  portForwardStatus?: Record<number, PortForwardStatus[]> // terminalId -> statuses
}

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
  path?: string // File path for code review comments
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

export interface GitDiffStat {
  added: number
  removed: number
  untracked: number
  untrackedLines: number
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface ChangedFile {
  path: string
  status: FileStatus
  added: number
  removed: number
  oldPath?: string
}

export interface GitLastCommit {
  hash: string
  author: string
  date: string // ISO 8601
  subject: string
  isLocal: boolean // true if author matches local git user.name
}

export interface GitDirtyPayload {
  dirtyStatus: Record<number, GitDiffStat> // terminalId -> line diff stats
  lastCommit?: Record<number, GitLastCommit> // terminalId -> last commit info
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

export interface ShellClient {
  device: string
  browser: string
  ip: string
  isPrimary?: boolean
}

export interface ShellClientsPayload {
  shellId: number
  clients: ShellClient[]
}

// Service status types
export type ServiceStatus = 'inactive' | 'starting' | 'healthy' | 'degraded' | 'error'

export interface GitHubApiStatus {
  status: ServiceStatus
  error: string | null
  remaining: number | null
  limit: number | null
  reset: number | null
  usedLastCycle: number | null
}

export interface NgrokStatus {
  status: ServiceStatus
  error: string | null
  url: string | null
}

export interface ClaudeSubStatus {
  status: ServiceStatus
  error: string | null
  retries: number
}

export interface ClaudeTunnelStatus {
  alias: string
  bootstrap: ClaudeSubStatus
  tunnel: ClaudeSubStatus
}

export interface ServicesStatus {
  githubRest: GitHubApiStatus
  githubGraphql: GitHubApiStatus
  ngrok: NgrokStatus
  claudeTunnels: Record<string, ClaudeTunnelStatus>
}

// GitHub webhook events we subscribe to
export const WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
] as const
