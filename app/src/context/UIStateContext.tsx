import { createContext, useContext, useState } from 'react'

type SettingsMode = 'open' | 'focused'

interface UIStateContextValue {
  settingsMode: SettingsMode | undefined
  settingsOpen: boolean
  settingsFocused: boolean
  /** Path to scroll to when settings opens, e.g. ['Terminal', 'Display'] */
  settingsTarget: string[] | null
  openSettings: (target?: string[]) => void
  focusSettings: () => void
  unfocusSettings: () => void
  closeSettings: () => void
  clearSettingsTarget: () => void
}

const UIStateContext = createContext<UIStateContextValue | null>(null)

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  const [settingsMode, setSettingsMode] = useState<SettingsMode | undefined>()
  const [settingsTarget, setSettingsTarget] = useState<string[] | null>(null)

  return (
    <UIStateContext.Provider
      value={{
        settingsMode,
        settingsOpen: settingsMode != null,
        settingsFocused: settingsMode === 'focused',
        settingsTarget,
        openSettings: (target?: string[]) => {
          setSettingsMode('focused')
          if (target) setSettingsTarget(target)
          window.dispatchEvent(new Event('collapse-sidebar'))
        },
        focusSettings: () => setSettingsMode('focused'),
        unfocusSettings: () => setSettingsMode((m) => (m ? 'open' : undefined)),
        closeSettings: () => {
          setSettingsMode(undefined)
          setSettingsTarget(null)
        },
        clearSettingsTarget: () => setSettingsTarget(null),
      }}
    >
      {children}
    </UIStateContext.Provider>
  )
}

export function useUIState() {
  const ctx = useContext(UIStateContext)
  if (!ctx) throw new Error('useUIState must be used within UIStateProvider')
  return ctx
}
