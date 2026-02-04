import type { ReactNode } from 'react'

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

export type NavigationResult = {
  modeId: string
  highlightedId?: string
}

export type PaletteMode = {
  id: string
  breadcrumbs: string[] // breadcrumb trail (empty for root mode)
  placeholder: string
  items: PaletteItem[] // flat list when no groups
  groups?: PaletteGroup[] // optional grouping
  emptyMessage?: string
  loading?: boolean
  footer?: (highlighted: PaletteItem | null) => ReactNode
  onBack?: () => NavigationResult | null
  width?: 'default' | 'wide' // palette width (default: default)
}

// API that mode factories receive to navigate and control the palette
export type PaletteAPI = {
  navigate: (result: NavigationResult) => void
  back: () => void
  close: () => void
}
