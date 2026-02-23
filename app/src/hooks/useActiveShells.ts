import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@/types'

const STORAGE_KEY = 'active-shells'

function loadStored(): Record<number, number> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch {
    return {}
  }
}

function persist(map: Record<number, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function useActiveShells(
  terminals: Terminal[],
  activeTerminalId: number | null,
) {
  const [raw, setRaw] = useState<Record<number, number>>(loadStored)

  // --- setShell: update state + persist + dispatch shell-select ---
  const setShell = (terminalId: number, shellId: number) => {
    setRaw((prev) => {
      const next = { ...prev, [terminalId]: shellId }
      persist(next)
      return next
    })
  }

  // --- Resolve: validate each selection still exists in its terminal ---
  const activeShells: Record<number, number> = {}
  for (const t of terminals) {
    const stored = raw[t.id]
    if (stored && t.shells.some((s) => s.id === stored)) {
      activeShells[t.id] = stored
    }
    // If invalid/missing, leave absent — callers already fall back to main
  }

  const activeShellsRef = useRef(activeShells)
  activeShellsRef.current = activeShells

  // --- Previous shell tracking: save outgoing, restore incoming ---
  const prevActiveTerminalIdRef = useRef<number | null>(activeTerminalId)
  const previousShellPerTerminal = useRef<Record<number, number>>({})

  useEffect(() => {
    const prevTid = prevActiveTerminalIdRef.current
    const newTid = activeTerminalId

    // Save outgoing terminal's active shell
    if (prevTid !== null && prevTid !== newTid) {
      const shellId = activeShellsRef.current[prevTid]
      if (shellId) previousShellPerTerminal.current[prevTid] = shellId
    }

    // Restore incoming terminal's previous shell
    if (newTid !== null && newTid !== prevTid) {
      const prevShellId = previousShellPerTerminal.current[newTid]
      if (prevShellId) {
        const terminal = terminals.find((t) => t.id === newTid)
        if (terminal?.shells.some((s) => s.id === prevShellId)) {
          setShell(newTid, prevShellId)
          window.dispatchEvent(
            new CustomEvent('shell-select', {
              detail: { terminalId: newTid, shellId: prevShellId },
            }),
          )
        }
      } else if (prevTid === null) {
        // On refresh (prev=null, next=active), dispatch shell-select to sync sidebar
        const shellId = activeShellsRef.current[newTid]
        if (shellId) {
          window.dispatchEvent(
            new CustomEvent('shell-select', {
              detail: { terminalId: newTid, shellId },
            }),
          )
        }
      }
    }

    prevActiveTerminalIdRef.current = newTid
  }, [activeTerminalId, terminals])

  // --- Stale cleanup: remove entries for deleted shells, fall back to main ---
  // Skip when terminals haven't loaded yet to avoid wiping stored selections.
  useEffect(() => {
    if (terminals.length === 0) return
    setRaw((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [tidStr, shellId] of Object.entries(next)) {
        const tid = Number(tidStr)
        const terminal = terminals.find((t) => t.id === tid)
        if (!terminal || !terminal.shells.some((s) => s.id === shellId)) {
          const main = terminal?.shells.find((s) => s.name === 'main')
          if (main) {
            next[tid] = main.id
          } else {
            delete next[tid]
          }
          changed = true
        }
      }
      if (changed) persist(next)
      return changed ? next : prev
    })
  }, [terminals])

  return { activeShells, activeShellsRef, setShell }
}
