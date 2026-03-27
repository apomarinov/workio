import { useEffect, useRef } from 'react'
import type { PanelSize } from 'react-resizable-panels'
import { usePanelRef } from 'react-resizable-panels'

interface PanelState {
  size: number
  preMaximizeSize: number
}

interface UsePersistedPanelOptions {
  /** Unique key for localStorage */
  id: string
  /** Default content panel size as percentage (0-100) */
  defaultSize?: number
  /** When true, content panel fills 100% and spacer collapses to 0% */
  maximized?: boolean
}

function readState(id: string, defaultSize: number): PanelState {
  try {
    const raw = localStorage.getItem(`panel-size:${id}`)
    if (raw) {
      const parsed = JSON.parse(raw) as PanelState
      if (
        typeof parsed.size === 'number' &&
        typeof parsed.preMaximizeSize === 'number'
      ) {
        return parsed
      }
    }
  } catch {}
  return { size: defaultSize, preMaximizeSize: defaultSize }
}

function writeState(id: string, state: PanelState) {
  try {
    localStorage.setItem(`panel-size:${id}`, JSON.stringify(state))
  } catch {}
}

export function usePersistedPanel({
  id,
  defaultSize = 30,
  maximized,
}: UsePersistedPanelOptions) {
  const spacerRef = usePanelRef()
  const contentRef = usePanelRef()

  const state = useRef(readState(id, defaultSize))
  const restoreSize = state.current.preMaximizeSize

  const handleContentResize = (size: PanelSize) => {
    if (maximized) return
    const s = size.asPercentage
    state.current = { size: s, preMaximizeSize: s }
    writeState(id, state.current)
  }

  useEffect(() => {
    if (maximized) {
      spacerRef.current?.resize('0%')
      contentRef.current?.resize('100%')
    } else {
      spacerRef.current?.resize(`${100 - restoreSize}%`)
      contentRef.current?.resize(`${restoreSize}%`)
    }
  }, [maximized, spacerRef, contentRef, restoreSize])

  return {
    spacerRef,
    contentRef,
    spacerDefaultSize: `${100 - restoreSize}%`,
    contentDefaultSize: `${restoreSize}%`,
    onContentResize: handleContentResize,
  }
}
