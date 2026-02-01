import { ArrowBigUp, ChevronUp, Command, Option } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { DEFAULT_KEYMAP, type Keymap, type ShortcutBinding } from '../types'
import { useSettings } from './useSettings'

function matchesBinding(e: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (!!binding.metaKey !== e.metaKey) return false
  if (!!binding.ctrlKey !== e.ctrlKey) return false
  if (!!binding.altKey !== e.altKey) return false
  if (!!binding.shiftKey !== e.shiftKey) return false
  if (binding.key !== undefined && e.key.toLowerCase() !== binding.key)
    return false
  return true
}

// --- Module-level modifier tracking ---

let heldState = { meta: false, ctrl: false, alt: false, shift: false }
const heldListeners = new Set<() => void>()

function emitHeld() {
  for (const l of heldListeners) l()
}

const KEY_TO_MOD: Record<string, keyof typeof heldState> = {
  Meta: 'meta',
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
}

function handleModKeyDown(e: KeyboardEvent) {
  const mod = KEY_TO_MOD[e.key]
  if (mod && !heldState[mod]) {
    heldState = { ...heldState, [mod]: true }
    emitHeld()
  }
}

function handleModKeyUp(e: KeyboardEvent) {
  const mod = KEY_TO_MOD[e.key]
  if (mod && heldState[mod]) {
    heldState = { ...heldState, [mod]: false }
    emitHeld()
  }
}

function handleModBlur() {
  if (heldState.meta || heldState.ctrl || heldState.alt || heldState.shift) {
    heldState = { meta: false, ctrl: false, alt: false, shift: false }
    emitHeld()
  }
}

window.addEventListener('keydown', handleModKeyDown, true)
window.addEventListener('keyup', handleModKeyUp)
window.addEventListener('blur', handleModBlur)

function subscribeHeld(listener: () => void) {
  heldListeners.add(listener)
  return () => heldListeners.delete(listener)
}

function getHeldSnapshot() {
  return heldState
}

// --- Modifier icons ---

function renderModifierIcons(
  binding: ShortcutBinding,
): (className?: string) => ReactNode {
  return (className) => (
    <>
      {binding.ctrlKey && <ChevronUp className={className} />}
      {binding.altKey && <Option className={className} />}
      {binding.shiftKey && <ArrowBigUp className={className} />}
      {binding.metaKey && <Command className={className} />}
    </>
  )
}

// --- useModifiersHeld: subscribes to held state, only re-renders subscribers ---

export function useModifiersHeld() {
  const held = useSyncExternalStore(subscribeHeld, getHeldSnapshot)
  const { settings } = useSettings()
  const paletteBinding = settings?.keymap?.palette ?? DEFAULT_KEYMAP.palette
  const goToTabBinding = settings?.keymap?.goToTab ?? DEFAULT_KEYMAP.goToTab

  const isGoToTabModifierHeld =
    held.meta === !!goToTabBinding.metaKey &&
    held.ctrl === !!goToTabBinding.ctrlKey &&
    held.alt === !!goToTabBinding.altKey &&
    held.shift === !!goToTabBinding.shiftKey

  return {
    held,
    isGoToTabModifierHeld,
    modifierIcons: {
      palette: renderModifierIcons(paletteBinding),
      goToTab: renderModifierIcons(goToTabBinding),
    } as Record<keyof Keymap, (className?: string) => ReactNode>,
  }
}

// --- useKeyboardShortcuts: registers handlers, no store subscription ---

type KeymapHandlers = Partial<Record<keyof Keymap, (e: KeyboardEvent) => void>>

export function useKeyboardShortcuts(handlers: KeymapHandlers) {
  const { settings } = useSettings()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const paletteBinding = settings?.keymap?.palette ?? DEFAULT_KEYMAP.palette
  const goToTabBinding = settings?.keymap?.goToTab ?? DEFAULT_KEYMAP.goToTab

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current

      // Go to tab: modifier(s) + digit 1-9
      if (
        h.goToTab &&
        e.key >= '1' &&
        e.key <= '9' &&
        matchesBinding(e, { ...goToTabBinding, key: undefined })
      ) {
        e.preventDefault()
        e.stopPropagation()
        h.goToTab(e)
        return
      }

      // Command palette
      if (
        h.palette &&
        paletteBinding.key &&
        matchesBinding(e, paletteBinding)
      ) {
        e.preventDefault()
        e.stopPropagation()
        h.palette(e)
        return
      }

      // Tab focuses the terminal when it's not already focused
      if (e.key === 'Tab') {
        const xtermTextarea = document.querySelector(
          '.xterm-helper-textarea',
        ) as HTMLTextAreaElement | null
        if (!xtermTextarea) return
        if (document.activeElement === xtermTextarea) return
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
        e.preventDefault()
        xtermTextarea.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [paletteBinding, goToTabBinding])
}
