import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import { usePanelRef } from 'react-resizable-panels'

export type PanelMode = 'minimized' | 'normal' | 'maximized'

interface PersistedState {
  size: number
  mode: PanelMode
}

interface UsePersistedPanelOptions {
  /** Unique key for localStorage */
  id: string
  /** Default content panel size as percentage (0-100) */
  defaultSize?: number
  /** Default mode if nothing is persisted */
  defaultMode?: PanelMode
}

const STORAGE_KEY = (id: string) => `panel-size:${id}`

function readState(
  id: string,
  defaultSize: number,
  defaultMode: PanelMode,
): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(id))
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState
      if (typeof parsed.size === 'number' && typeof parsed.mode === 'string') {
        return parsed
      }
      // Migrate old format { size, preMaximizeSize }
      if (typeof parsed.size === 'number') {
        return { size: parsed.size, mode: defaultMode }
      }
    }
  } catch {}
  return { size: defaultSize, mode: defaultMode }
}

function writeState(id: string, state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY(id), JSON.stringify(state))
  } catch {}
}

function sizesForMode(mode: PanelMode, size: number) {
  switch (mode) {
    case 'minimized':
      return { content: '0%', spacer: '100%' }
    case 'maximized':
      return { content: '100%', spacer: '0%' }
    case 'normal':
      return { content: `${size}%`, spacer: `${100 - size}%` }
  }
}

export function usePersistedPanel({
  id,
  defaultSize = 30,
  defaultMode = 'normal',
}: UsePersistedPanelOptions) {
  const spacerRef = usePanelRef()
  const contentRef = usePanelRef()

  const persisted = useRef(readState(id, defaultSize, defaultMode))
  const [mode, setModeState] = useState<PanelMode>(persisted.current.mode)
  const initialSizes = sizesForMode(
    persisted.current.mode,
    persisted.current.size,
  )

  const setMode = useCallback(
    (newMode: PanelMode | ((prev: PanelMode) => PanelMode)) => {
      setModeState((prev) => {
        const resolved = typeof newMode === 'function' ? newMode(prev) : newMode
        persisted.current = { ...persisted.current, mode: resolved }
        writeState(id, persisted.current)
        return resolved
      })
    },
    [id],
  )

  const handleContentResize = (size: PanelSize) => {
    // Only persist size during normal dragging
    if (mode !== 'normal') return
    if (size.asPercentage < 1) return
    persisted.current = { ...persisted.current, size: size.asPercentage }
    writeState(id, persisted.current)
  }

  // Resize panels when mode changes (skip initial mount — defaultSize handles that)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const sizes = sizesForMode(mode, persisted.current.size)
    contentRef.current?.resize(sizes.content)
    spacerRef.current?.resize(sizes.spacer)
  }, [mode, spacerRef, contentRef])

  return {
    spacerRef,
    contentRef,
    spacerDefaultSize: initialSizes.spacer,
    contentDefaultSize: initialSizes.content,
    onContentResize: handleContentResize,
    mode,
    setMode,
  }
}
