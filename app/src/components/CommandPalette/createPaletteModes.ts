import type { BranchInfo } from '@/lib/api'
import type {
  GitDiffStat,
  MergedPRSummary,
  PRCheckStatus,
} from '../../../shared/types'
import type { SessionWithProject, Terminal } from '../../types'
import { createActionsMode } from './modes/actions'
import { createBranchActionsMode, createBranchesMode } from './modes/branches'
import { createSearchMode } from './modes/search'
import type { PaletteAPI, PaletteMode } from './types'

// App-specific data that modes need
export type AppData = {
  terminals: Terminal[]
  sessions: SessionWithProject[]
  githubPRs: PRCheckStatus[]
  mergedPRs: MergedPRSummary[]
  gitDirtyStatus: Record<number, GitDiffStat>
  pinnedTerminalSessions: number[]
  pinnedSessions: string[]
}

// State specific to the current mode navigation
export type ModeState = {
  terminal: Terminal | null
  session: SessionWithProject | null
  pr: PRCheckStatus | null
  branch: { name: string; isRemote: boolean; isCurrent: boolean } | null
  branches: { local: BranchInfo[]; remote: BranchInfo[] } | null
  branchesLoading: boolean
  loadingStates: {
    checkingOut?: string
    pulling?: string
    pushing?: { branch: string; force: boolean }
  }
}

// Actions that modes can trigger
export type AppActions = {
  // Navigation
  selectTerminal: (id: number) => void
  selectSession: (id: string) => void
  revealPR: (pr: { branch: string; repo: string }) => void

  // Terminal actions
  openInCursor: (terminal: Terminal) => void
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

  // Branch actions
  loadBranches: (terminalId: number) => void
  checkoutBranch: (name: string, isRemote: boolean) => Promise<void>
  pullBranch: (name: string) => Promise<void>
  pushBranch: (name: string, force?: boolean) => Promise<void>
  requestForcePush: (terminalId: number, branch: string) => void

  // Mode state setters
  setSelectedTerminal: (
    terminal: Terminal | null,
    pr: PRCheckStatus | null,
  ) => void
  setSelectedSession: (session: SessionWithProject | null) => void
  setSelectedBranch: (
    branch: { name: string; isRemote: boolean; isCurrent: boolean } | null,
  ) => void
}

// Factory creates modes with data already bound
export function createPaletteModes(
  data: AppData,
  state: ModeState,
  actions: AppActions,
  api: PaletteAPI,
): Record<string, PaletteMode> {
  return {
    search: createSearchMode(data, state, actions, api),
    actions: createActionsMode(data, state, actions, api),
    branches: createBranchesMode(data, state, actions, api),
    'branch-actions': createBranchActionsMode(data, state, actions, api),
  }
}

// Helper to get last path segment
export function getLastPathSegment(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}
