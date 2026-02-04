import type { ReactNode } from 'react'
import type { BranchInfo } from '@/lib/api'
import type { PRCheckStatus } from '../../../shared/types'
import type { SessionWithProject, Terminal } from '../../types'

// Generic types - the palette core knows nothing about terminals, sessions, etc.

export type PaletteItem = {
  id: string
  label: string
  description?: ReactNode // sub-line text
  icon?: ReactNode
  rightSlot?: ReactNode // badges, checkmarks
  keywords?: string[]
  disabled?: boolean
  disabledReason?: string
  loading?: boolean
  onSelect: () => void
  onNavigate?: () => void // ArrowRight -> opens submenu
}

export type PaletteGroup = {
  heading: string
  items: PaletteItem[]
}

// Each level in the navigation stack carries its context
export type PaletteLevel = {
  mode: string
  title: string // for breadcrumb (empty for root)
  highlightedId?: string

  // Context (each level carries what it needs)
  terminal?: Terminal
  pr?: PRCheckStatus
  session?: SessionWithProject
  branch?: { name: string; isRemote: boolean; isCurrent: boolean }
  branches?: { local: BranchInfo[]; remote: BranchInfo[] }
  branchesLoading?: boolean
  loadingStates?: {
    checkingOut?: string
    pulling?: string
    pushing?: { branch: string; force: boolean }
    rebasing?: string
    deleting?: string
  }
}

export type PaletteMode = {
  id: string
  placeholder: string
  items: PaletteItem[] // flat list when no groups
  groups?: PaletteGroup[] // optional grouping
  emptyMessage?: string
  loading?: boolean
  footer?: (highlighted: PaletteItem | null) => ReactNode
  width?: 'default' | 'wide' // palette width (default: default)
}

// API that mode factories receive to navigate and control the palette
export type PaletteAPI = {
  push: (
    level: Omit<PaletteLevel, 'highlightedId'> & { highlightedId?: string },
  ) => void
  pop: () => void
  updateLevel: (updater: (prev: PaletteLevel) => PaletteLevel) => void // for async loading
  close: () => void
}
