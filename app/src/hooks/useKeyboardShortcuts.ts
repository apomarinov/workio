import { useCallback, useEffect, useRef } from 'react'
import { useSessionContext } from '../context/SessionContext'
import { useTerminalContext } from '../context/TerminalContext'

export function useKeyboardShortcuts() {
  const { terminals, selectTerminal } = useTerminalContext()
  const { clearSession } = useSessionContext()
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

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [selectByIndex])
}
