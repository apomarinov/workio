import { createContext, useContext, useState } from 'react'
import type { SettingsPath } from '@/components/settings/settings-registry'

type SettingsMode = 'open' | 'focused'

interface SettingsState {
  mode: SettingsMode | undefined
  target: string[] | null
}

interface SettingsContextValue {
  mode: SettingsMode | undefined
  isOpen: boolean
  isFocused: boolean
  target: string[] | null
  open: (target?: SettingsPath) => void
  focus: () => void
  unfocus: () => void
  close: () => void
  clearTarget: () => void
}

const DEFAULT_STATE: SettingsState = {
  mode: undefined,
  target: null,
}

interface UIStateContextValue {
  settings: SettingsContextValue
}

const UIStateContext = createContext<UIStateContextValue | null>(null)

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SettingsState>(DEFAULT_STATE)

  const settings: SettingsContextValue = {
    mode: state.mode,
    isOpen: state.mode != null,
    isFocused: state.mode === 'focused',
    target: state.target,
    open: (target?: SettingsPath) => {
      setState({ mode: 'focused', target: target ? [...target] : null })
      window.dispatchEvent(new Event('settings-open'))
    },
    focus: () => setState((prev) => ({ ...prev, mode: 'focused' })),
    unfocus: () =>
      setState((prev) => ({
        ...prev,
        mode: prev.mode ? 'open' : undefined,
      })),
    close: () => setState(DEFAULT_STATE),
    clearTarget: () => setState((prev) => ({ ...prev, target: null })),
  }

  return (
    <UIStateContext.Provider value={{ settings }}>
      {children}
    </UIStateContext.Provider>
  )
}

export function useUIState() {
  const ctx = useContext(UIStateContext)
  if (!ctx) throw new Error('useUIState must be used within UIStateProvider')
  return ctx
}
