import { createContext, useContext, useEffect, useState } from 'react'
import { useUIState } from '@/context/UIStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import {
  type FlatSetting,
  SETTINGS_REGISTRY,
  type SettingsSection,
  searchSettings,
} from './settings-registry'

interface SettingsViewContextValue {
  search: string
  setSearch: (value: string) => void
  filtered: FlatSetting[]
  matchedCategories: Set<string>
  activePath: string[] | null
  setActivePath: (path: string[] | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  keymapOpen: boolean
  openKeymap: () => void
  closeKeymap: () => void
  isMobile: boolean
  categories: SettingsSection[]
  scrollToSection: (path: string[]) => void
}

const SettingsViewContext = createContext<SettingsViewContextValue | null>(null)

/** Walk the tree depth-first and return the path to the first section that has settings */
function getFirstSettingsPath(sections: SettingsSection[]): string[] | null {
  for (const section of sections) {
    if (section.settings && section.settings.length > 0) {
      return [section.name]
    }
    if (section.children) {
      const child = getFirstSettingsPath(section.children)
      if (child) return [section.name, ...child]
    }
  }
  return null
}

export function SettingsViewProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [keymapOpen, setKeymapOpen] = useState(false)
  const [activePath, setActivePath] = useState<string[] | null>(() =>
    getFirstSettingsPath(SETTINGS_REGISTRY),
  )
  const isMobile = useIsMobile()
  const { settingsTarget, clearSettingsTarget } = useUIState()

  // Scroll to target setting when settings opens with a specific path
  useEffect(() => {
    if (!settingsTarget) return
    clearSettingsTarget()

    // Keymap section opens the dedicated keymap view
    if (settingsTarget[0] === 'Keymap') {
      setKeymapOpen(true)
      setActivePath(settingsTarget)
      return
    }

    setKeymapOpen(false)
    setActivePath(settingsTarget)
    // Defer scroll to next frame so the DOM has rendered
    requestAnimationFrame(() => {
      const id = `settings-section-${settingsTarget.join('-')}`
      const el = document.getElementById(id)
      if (el) {
        const container = el.closest('[data-settings-scroll]')
        if (container) {
          const top = el.offsetTop - 45
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
      }
    })
  }, [settingsTarget, clearSettingsTarget])

  const filtered = searchSettings(search)
  const matchedCategories = new Set(filtered.map((s) => s.ancestors[0]))

  const scrollToSection = (path: string[]) => {
    const id = `settings-section-${path.join('-')}`
    const el = document.getElementById(id)
    if (el) {
      const container = el.closest('[data-settings-scroll]')
      if (container) {
        const top = el.offsetTop - 45
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      } else {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    }
    setActivePath(path)
    if (isMobile) setSidebarOpen(false)
  }

  return (
    <SettingsViewContext.Provider
      value={{
        search,
        setSearch,
        filtered,
        matchedCategories,
        activePath,
        setActivePath,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen((v) => !v),
        keymapOpen,
        openKeymap: () => setKeymapOpen(true),
        closeKeymap: () => setKeymapOpen(false),
        isMobile,
        categories: SETTINGS_REGISTRY,
        scrollToSection,
      }}
    >
      {children}
    </SettingsViewContext.Provider>
  )
}

export function useSettingsView() {
  const ctx = useContext(SettingsViewContext)
  if (!ctx)
    throw new Error('useSettingsView must be used within SettingsViewProvider')
  return ctx
}
