export interface ActiveProcess {
  pid: number
  name: string
  command: string
  terminalId?: number
  source?: 'direct' | 'zellij'
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
}

export interface PRComment {
  url?: string
  author: string
  avatarUrl: string
  body: string
  createdAt: string
}

export interface PRReview {
  id?: number
  author: string
  avatarUrl: string
  state: string
  body: string
}

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
  createdAt: string
  updatedAt: string
  areAllChecksOk: boolean
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
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
}

export interface GitDiffStat {
  added: number
  removed: number
  untracked: number
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
