import type {
  ActiveProcess,
  GitDiffStat,
  MergedPRSummary,
  PRCheckStatus,
} from '../../../shared/types'
import type {
  CustomTerminalAction,
  MoveTarget,
  PreferredIDE,
  SessionSearchMatch,
  SessionWithProject,
  ShellTemplate,
  Terminal,
} from '../../types'
import { createActionsMode } from './modes/actions'
import { createBranchClaudeSessionsMode } from './modes/branch-claude-sessions'
import { createBranchActionsMode, createBranchesMode } from './modes/branches'
import { createCustomCommandsMode } from './modes/custom-commands'
import { createFavoriteSessionsMode } from './modes/favorite-sessions'
import { createMoveToProjectMode } from './modes/move-to-project'
import { createPRActionsMode } from './modes/pr-actions'
import { createPRCheckoutMode } from './modes/pr-checkout'
import { createSearchMode } from './modes/search'
import { createSessionSearchMode } from './modes/session-search'
import { createShellTemplatesMode } from './modes/shell-templates'
import { createShellsMode } from './modes/shells'
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
  processes: ActiveProcess[]
  shellPorts: Record<number, number[]>
  shellTemplates: ShellTemplate[]
  starredBranches: Record<string, string[]>
  customActions: CustomTerminalAction[]
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
  resumeSession: (session: SessionWithProject) => void
  openRenameModal: (session: SessionWithProject) => void
  openDeleteSessionModal: (session: SessionWithProject) => void
  loadMoveTargets: (sessionId: string) => void
  openMoveSessionModal: (
    session: SessionWithProject,
    target: MoveTarget,
  ) => void

  // Pin actions
  toggleTerminalPin: (terminalId: number) => void
  toggleSessionPin: (sessionId: string) => void
  toggleFavoriteSession: (sessionId: string) => void

  // Branch actions
  fetchAll: (terminalId: number) => Promise<void>
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
  requestRenameBranch: (terminalId: number, branch: string) => void

  // Star actions
  toggleStarBranch: (repo: string, branchName: string) => void

  // Shell actions
  selectShell: (terminalId: number, shellId: number) => void
  runTemplate: (template: ShellTemplate) => void

  // Terminal paste
  sendToTerminal: (terminalId: number, text: string) => void

  // Cleanup actions
  openCleanupModal: () => void

  // PR actions
  openCreatePRModal: (terminal: Terminal) => void
  openDiffViewer: (pr: PRCheckStatus, terminalId: number) => void
  openMergeModal: (pr: PRCheckStatus) => void
  openCloseModal: (pr: PRCheckStatus) => void
  openEditPRModal: (pr: PRCheckStatus) => void
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
    'branch-claude-sessions': createBranchClaudeSessionsMode(
      data,
      level,
      actions,
      api,
    ),
    'pr-actions': createPRActionsMode(data, level, actions, api),
    'pr-checkout': createPRCheckoutMode(data, level, actions, api),
    'move-to-project': createMoveToProjectMode(data, level, actions, api),
    shells: createShellsMode(data, level, actions, api),
    'session-search': createSessionSearchMode(data, level, actions, api),
    'favorite-sessions': createFavoriteSessionsMode(data, level, actions, api),
    'shell-templates': createShellTemplatesMode(data, level, actions, api),
    'custom-commands': createCustomCommandsMode(data, level, actions, api),
  }
}

// Helper to get last path segment
export function getLastPathSegment(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}
