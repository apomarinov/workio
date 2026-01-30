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
}

export interface FailedPRCheck {
  name: string
  status: string
  conclusion: string
  detailsUrl: string
}

export interface PRComment {
  author: string
  avatarUrl: string
  body: string
  createdAt: string
}

export interface PRReview {
  author: string
  avatarUrl: string
  state: string
  body: string
}

export interface PRCheckStatus {
  prNumber: number
  prTitle: string
  prUrl: string
  branch: string
  repo: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  reviews: PRReview[]
  checks: FailedPRCheck[]
  comments: PRComment[]
  updatedAt: string
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

export interface PRChecksPayload {
  prs: PRCheckStatus[]
}
