import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useSessionContext } from './SessionContext'
import { useTerminalContext } from './TerminalContext'

interface KeyMapContextValue {
  cmdHeld: boolean
}

const KeyMapContext = createContext<KeyMapContextValue | null>(null)

export function KeyMapProvider({ children }: { children: React.ReactNode }) {
  const { terminals, selectTerminal } = useTerminalContext()
  const { clearSession } = useSessionContext()
  const [cmdHeld, setCmdHeld] = useState(false)
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals

  const selectByIndex = useCallback(
    (index: number) => {
      const terminal = terminalsRef.current[index]
      if (terminal) {
        selectTerminal(terminal.id)
        clearSession()
      }
    },
    [selectTerminal, clearSession],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta') setCmdHeld(true)

      if (e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        e.stopPropagation()
        selectByIndex(Number.parseInt(e.key, 10) - 1)
      }

      // Tab focuses the terminal when it's not already focused
      if (e.key === 'Tab') {
        const xtermTextarea = document.querySelector(
          '.xterm-helper-textarea',
        ) as HTMLTextAreaElement | null
        if (!xtermTextarea) return
        if (document.activeElement === xtermTextarea) return
        // Don't steal focus from other form inputs
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
        e.preventDefault()
        xtermTextarea.focus()
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta') setCmdHeld(false)
    }
    const handleBlur = () => setCmdHeld(false)

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [selectByIndex])

  return (
    <KeyMapContext.Provider value={{ cmdHeld }}>
      {children}
    </KeyMapContext.Provider>
  )
}

export function useKeyMapContext() {
  const context = useContext(KeyMapContext)
  if (!context) {
    throw new Error('useKeyMapContext must be used within KeyMapProvider')
  }
  return context
}
