import type { Terminal } from '@domains/workspace/schema/terminals'
import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'shell-last-active'
const MOUNT_WINDOW = 15 * 60 * 1000 // 15 minutes
const MAX_ENTRIES = 50

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

export function useShellLastActive(terminals: Terminal[]) {
  const [timestamps, setTimestamps] =
    useState<Record<number, number>>(loadStored)
  const [, setTick] = useState(0)

  // 60-second tick so shells age out while the app is open
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // Clean up entries for deleted shells and cap at MAX_ENTRIES
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals

  useEffect(() => {
    if (terminals.length === 0) return
    const allShellIds = new Set<number>()
    for (const t of terminals) {
      for (const s of t.shells) {
        allShellIds.add(s.id)
      }
    }

    setTimestamps((prev) => {
      const next = { ...prev }
      let changed = false

      // Remove entries for shells that no longer exist
      for (const key of Object.keys(next)) {
        if (!allShellIds.has(Number(key))) {
          delete next[Number(key)]
          changed = true
        }
      }

      // Cap at MAX_ENTRIES — evict oldest by lastActiveAt
      const entries = Object.entries(next)
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => a[1] - b[1])
        const toRemove = entries.slice(0, entries.length - MAX_ENTRIES)
        for (const [key] of toRemove) {
          delete next[key as unknown as number]
        }
        changed = true
      }

      if (changed) {
        persist(next)
        return next
      }
      return prev
    })
  }, [terminals])

  const markInactive = (shellId: number) => {
    setTimestamps((prev) => {
      const next = { ...prev, [shellId]: Date.now() }

      // Clean up entries for shells that no longer exist and cap
      const allShellIds = new Set<number>()
      for (const t of terminalsRef.current) {
        for (const s of t.shells) {
          allShellIds.add(s.id)
        }
      }
      for (const key of Object.keys(next)) {
        if (!allShellIds.has(Number(key))) {
          delete next[Number(key)]
        }
      }
      const entries = Object.entries(next)
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => a[1] - b[1])
        for (const [key] of entries.slice(0, entries.length - MAX_ENTRIES)) {
          delete next[key as unknown as number]
        }
      }

      persist(next)
      return next
    })
  }

  const shouldMount = (
    shellId: number,
    isActive: boolean,
    hasActivity?: boolean,
  ): boolean => {
    if (isActive) return true
    if (hasActivity) return true
    const lastActiveAt = timestamps[shellId]
    if (lastActiveAt === undefined) return false // no timestamp = never activated
    return Date.now() - lastActiveAt < MOUNT_WINDOW
  }

  return { markInactive, shouldMount }
}
