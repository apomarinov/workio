import { ArrowBigUp, ChevronUp, Command, Option } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { DEFAULT_KEYMAP, type Keymap, type ShortcutBinding } from '../types'
import { useSettings } from './useSettings'
import { useDocumentPip } from '@/context/DocumentPipContext'

type ModifierBuffer = {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

function modifiersMatchBinding(
  buf: ModifierBuffer,
  binding: ShortcutBinding,
): boolean {
  if (buf.meta !== !!binding.metaKey) return false
  if (buf.ctrl !== !!binding.ctrlKey) return false
  if (buf.alt !== !!binding.altKey) return false
  if (buf.shift !== !!binding.shiftKey) return false
  return true
}

// --- Module-level modifier tracking ---

let heldState = { meta: false, ctrl: false, alt: false, shift: false }
let suppressHeld = false
const EMPTY_HELD = { meta: false, ctrl: false, alt: false, shift: false }
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
  if (!mod || heldState[mod]) return
  heldState = { ...heldState, [mod]: true }
  if (!suppressHeld) emitHeld()
}

function handleModKeyUp(e: KeyboardEvent) {
  const mod = KEY_TO_MOD[e.key]
  if (mod && heldState[mod]) {
    heldState = { ...heldState, [mod]: false }
    if (!suppressHeld) emitHeld()
  }
  if (
    suppressHeld &&
    !heldState.meta &&
    !heldState.ctrl &&
    !heldState.alt &&
    !heldState.shift
  ) {
    suppressHeld = false
  }
}

function handleModBlur() {
  suppressHeld = false
  if (heldState.meta || heldState.ctrl || heldState.alt || heldState.shift) {
    heldState = { meta: false, ctrl: false, alt: false, shift: false }
    emitHeld()
  }
}

function suppressModifiers() {
  if (!suppressHeld) {
    suppressHeld = true
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
  return suppressHeld ? EMPTY_HELD : heldState
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

interface KeymapHandlers {
  palette?: (e: KeyboardEvent) => void
  goToTab?: (index: number) => void
  goToLastTab?: () => void
  togglePip?: () => void
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

export function useKeyboardShortcuts(handlers: KeymapHandlers) {
  const { settings } = useSettings()
  const pip = useDocumentPip()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const paletteBinding = settings?.keymap?.palette ?? DEFAULT_KEYMAP.palette
  const goToTabBinding = settings?.keymap?.goToTab ?? DEFAULT_KEYMAP.goToTab
  const goToLastTabBinding =
    settings?.keymap?.goToLastTab ?? DEFAULT_KEYMAP.goToLastTab
  const togglePipBinding =
    settings?.keymap?.togglePip ?? DEFAULT_KEYMAP.togglePip

  useEffect(() => {
    let modifierBuffer: ModifierBuffer = {
      meta: false,
      ctrl: false,
      alt: false,
      shift: false,
    }
    let digitBuffer: string[] = []
    let keyBuffer: string[] = []
    const heldNonModKeys = new Set<string>()
    let active = false

    function reset() {
      modifierBuffer = { meta: false, ctrl: false, alt: false, shift: false }
      digitBuffer = []
      keyBuffer = []
      heldNonModKeys.clear()
      active = false
      consumed = false
    }

    let consumed = false // true after a shortcut fires; blocks until all modifiers released

    const handleKeyDown = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) {
        const mod = KEY_TO_MOD[e.key]
        if (mod && !modifierBuffer[mod]) {
          modifierBuffer = { ...modifierBuffer, [mod]: true }
          active = true
        }
        return
      }
      // Non-modifier key while a modifier sequence is active
      if (active) {
        if (consumed || heldNonModKeys.has(e.code)) return
        heldNonModKeys.add(e.code)

        const h = handlersRef.current
        const key = e.key.toLowerCase()
        keyBuffer.push(key)

        // Check palette: modifiers + accumulated keys match binding
        if (
          h.palette &&
          paletteBinding.key &&
          modifiersMatchBinding(modifierBuffer, paletteBinding) &&
          keyBuffer.join('') === paletteBinding.key
        ) {
          e.preventDefault()
          e.stopPropagation()
          h.palette(new KeyboardEvent('keydown'))
          consumed = true
          suppressModifiers()
          return
        }

        // Check togglePip: modifiers + accumulated keys match binding
        if (
          h.togglePip &&
          togglePipBinding.key &&
          modifiersMatchBinding(modifierBuffer, togglePipBinding) &&
          keyBuffer.join('') === togglePipBinding.key
        ) {
          e.preventDefault()
          e.stopPropagation()
          h.togglePip()
          consumed = true
          suppressModifiers()
          return
        }

        // Check goToTab: modifiers match + physical digit key pressed
        // Use e.code for digit detection (Shift+3 gives e.key='#' but e.code='Digit3')
        const digit =
          e.code >= 'Digit0' && e.code <= 'Digit9' ? e.code[5] : null
        if (
          h.goToTab &&
          digit &&
          modifiersMatchBinding(modifierBuffer, goToTabBinding)
        ) {
          e.preventDefault()
          e.stopPropagation()
          digitBuffer.push(digit)
          h.goToTab(Number.parseInt(digitBuffer.join(''), 10))
          consumed = true
          suppressModifiers()
        }

        return
      }

      // Plain key with no modifiers held: check for modifier-free palette binding
      const h = handlersRef.current
      if (
        h.palette &&
        paletteBinding.key &&
        !paletteBinding.metaKey &&
        !paletteBinding.ctrlKey &&
        !paletteBinding.altKey &&
        !paletteBinding.shiftKey &&
        e.key.toLowerCase() === paletteBinding.key
      ) {
        const el = e.target as HTMLElement
        const tag = el?.tagName
        if (
          tag !== 'INPUT' &&
          tag !== 'SELECT' &&
          tag !== 'TEXTAREA' &&
          !el?.isContentEditable
        ) {
          e.preventDefault()
          e.stopPropagation()
          h.palette(new KeyboardEvent('keydown'))
          return
        }
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(e.key)) {
        heldNonModKeys.delete(e.code)
      }
      if (!active) return

      // When all modifiers released, check for modifier-only goToLastTab
      if (
        !heldState.meta &&
        !heldState.ctrl &&
        !heldState.alt &&
        !heldState.shift
      ) {
        if (
          !consumed &&
          keyBuffer.length === 0 &&
          digitBuffer.length === 0 &&
          modifiersMatchBinding(modifierBuffer, goToLastTabBinding) &&
          handlersRef.current.goToLastTab
        ) {
          handlersRef.current.goToLastTab()
          suppressModifiers()
        }
        reset()
      }
    }

    const handleBlur = () => {
      reset()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [paletteBinding, goToTabBinding, goToLastTabBinding, togglePipBinding, pip.window])
}
