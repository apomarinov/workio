import type {
  GitDiffStat,
  MergedPRSummary,
  PRCheckStatus,
} from '../../../shared/types'
import type {
  PreferredIDE,
  SessionSearchMatch,
  SessionWithProject,
  Terminal,
} from '../../types'
import { createActionsMode } from './modes/actions'
import { createBranchActionsMode, createBranchesMode } from './modes/branches'
import { createFavoriteSessionsMode } from './modes/favorite-sessions'
import { createPRActionsMode } from './modes/pr-actions'
import { createPRCheckoutMode } from './modes/pr-checkout'
import { createSearchMode } from './modes/search'
import { createSessionSearchMode } from './modes/session-search'
import { createShellMode } from './modes/shell'
import type { PaletteAPI, PaletteLevel, PaletteMode } from './types'

// App-specific data that modes need
export type AppData = {
  terminals: Terminal[]
  sessions: SessionWithProject[]
  githubPRs: PRCheckStatus[]
  mergedPRs: MergedPRSummary[]
  gitDirtyStatus: Record<number, GitDiffStat>
  pinnedTerminalSessions: number[]
  pinnedSessions: string[]
  preferredIDE: PreferredIDE
  sessionSearchResults: SessionSearchMatch[] | null
  sessionSearchLoading: boolean
  sessionSearchQuery: string
}

// Actions that modes can trigger
export type AppActions = {
  // Navigation
  selectTerminal: (id: number) => void
  selectSession: (id: string) => void
  revealPR: (pr: { branch: string; repo: string }) => void

  // Terminal actions
  openInIDE: (terminal: Terminal) => void
  openInExplorer: (terminal: Terminal) => void
  openPR: (pr: PRCheckStatus) => void
  addWorkspace: (terminal: Terminal) => void
  openEditModal: (terminal: Terminal) => void
  openDeleteModal: (terminal: Terminal) => void

  // Session actions
  openRenameModal: (session: SessionWithProject) => void
  openDeleteSessionModal: (session: SessionWithProject) => void

  // Pin actions
  toggleTerminalPin: (terminalId: number) => void
  toggleSessionPin: (sessionId: string) => void
  toggleFavoriteSession: (sessionId: string) => void

  // Branch actions
  loadBranches: (terminalId: number) => void
  checkoutBranch: (name: string, isRemote: boolean) => Promise<void>
  pullBranch: (name: string) => Promise<void>
  pushBranch: (name: string, force?: boolean) => Promise<void>
  requestForcePush: (terminalId: number, branch: string) => void
  rebaseBranch: (name: string) => Promise<void>
  requestDeleteBranch: (
    terminalId: number,
    branch: string,
    hasRemote: boolean,
  ) => void
  requestCommit: (terminalId: number) => void
  requestCreateBranch: (terminalId: number, fromBranch: string) => void

  // Shell actions
  openFilePicker: (terminal: Terminal) => void

  // PR actions
  openMergeModal: (pr: PRCheckStatus) => void
  openCloseModal: (pr: PRCheckStatus) => void
  openRerunAllModal: (pr: PRCheckStatus) => void
  checkoutPRBranch: (terminalId: number, branch: string) => Promise<void>
  hidePR: (pr: PRCheckStatus) => Promise<void>
}

// Factory creates modes with data already bound
export function createPaletteModes(
  data: AppData,
  level: PaletteLevel,
  actions: AppActions,
  api: PaletteAPI,
): Record<string, PaletteMode> {
  return {
    search: createSearchMode(data, level, actions, api),
    actions: createActionsMode(data, level, actions, api),
    branches: createBranchesMode(data, level, actions, api),
    'branch-actions': createBranchActionsMode(data, level, actions, api),
    'pr-actions': createPRActionsMode(data, level, actions, api),
    'pr-checkout': createPRCheckoutMode(data, level, actions, api),
    shell: createShellMode(data, level, actions, api),
    'session-search': createSessionSearchMode(data, level, actions, api),
    'favorite-sessions': createFavoriteSessionsMode(data, level, actions, api),
  }
}

// Helper to get last path segment
export function getLastPathSegment(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}
