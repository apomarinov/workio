import { createContext, useContext, useState } from 'react'

type SettingsMode = 'open' | 'focused'

interface UIStateContextValue {
  settingsMode: SettingsMode | undefined
  settingsOpen: boolean
  settingsFocused: boolean
  openSettings: () => void
  focusSettings: () => void
  unfocusSettings: () => void
  closeSettings: () => void
}

const UIStateContext = createContext<UIStateContextValue | null>(null)

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  const [settingsMode, setSettingsMode] = useState<SettingsMode | undefined>()

  return (
    <UIStateContext.Provider
      value={{
        settingsMode,
        settingsOpen: settingsMode != null,
        settingsFocused: settingsMode === 'focused',
        openSettings: () => {
          setSettingsMode('focused')
          window.dispatchEvent(new Event('collapse-sidebar'))
        },
        focusSettings: () => setSettingsMode('focused'),
        unfocusSettings: () => setSettingsMode((m) => (m ? 'open' : undefined)),
        closeSettings: () => setSettingsMode(undefined),
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
