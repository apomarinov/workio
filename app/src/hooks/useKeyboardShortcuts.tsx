import { ArrowBigUp, ChevronUp, Command, Option } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useDocumentPip } from '@/context/DocumentPipContext'
import { DEFAULT_KEYMAP, type Keymap, type ShortcutBinding } from '../types'
import { useSettings } from './useSettings'

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
  const paletteBinding =
    settings?.keymap?.palette === null
      ? null
      : (settings?.keymap?.palette ?? DEFAULT_KEYMAP.palette)
  const goToTabBinding =
    settings?.keymap?.goToTab === null
      ? null
      : (settings?.keymap?.goToTab ?? DEFAULT_KEYMAP.goToTab)
  const goToShellBinding =
    settings?.keymap?.goToShell === null
      ? null
      : (settings?.keymap?.goToShell ?? DEFAULT_KEYMAP.goToShell)

  const isGoToTabModifierHeld =
    goToTabBinding !== null &&
    held.meta === !!goToTabBinding.metaKey &&
    held.ctrl === !!goToTabBinding.ctrlKey &&
    held.alt === !!goToTabBinding.altKey &&
    held.shift === !!goToTabBinding.shiftKey

  const isGoToShellModifierHeld =
    goToShellBinding !== null &&
    held.meta === !!goToShellBinding.metaKey &&
    held.ctrl === !!goToShellBinding.ctrlKey &&
    held.alt === !!goToShellBinding.altKey &&
    held.shift === !!goToShellBinding.shiftKey

  return {
    held,
    isGoToTabModifierHeld,
    isGoToShellModifierHeld,
    modifierIcons: {
      palette: paletteBinding
        ? renderModifierIcons(paletteBinding)
        : () => null,
      goToTab: goToTabBinding
        ? renderModifierIcons(goToTabBinding)
        : () => null,
      goToShell: goToShellBinding
        ? renderModifierIcons(goToShellBinding)
        : () => null,
    } as Record<keyof Keymap, (className?: string) => ReactNode>,
  }
}

// --- useKeyboardShortcuts: registers handlers, no store subscription ---

interface KeymapHandlers {
  palette?: (e: KeyboardEvent) => void
  goToTab?: (index: number) => void
  goToLastTab?: () => void
  goToShell?: (index: number) => void
  prevShell?: () => void
  nextShell?: () => void
  togglePip?: () => void
  itemActions?: () => void
  collapseAll?: () => void
  settings?: () => void
  newShell?: () => void
  closeShell?: () => void
  commitAmend?: () => void
  commitNoVerify?: () => void
  shellTemplates?: () => void
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

export function useKeyboardShortcuts(handlers: KeymapHandlers) {
  const { settings } = useSettings()
  const pip = useDocumentPip()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const disabledRef = useRef(false)
  const commitDialogOpenRef = useRef(false)

  useEffect(() => {
    const onDisable = (e: Event) => {
      disabledRef.current = (e as CustomEvent).detail
    }
    const onCommitDialog = (e: Event) => {
      commitDialogOpenRef.current = (e as CustomEvent).detail
    }
    window.addEventListener('shortcuts-disabled', onDisable)
    window.addEventListener('commit-dialog-open', onCommitDialog)
    return () => {
      window.removeEventListener('shortcuts-disabled', onDisable)
      window.removeEventListener('commit-dialog-open', onCommitDialog)
    }
  }, [])

  const paletteBinding =
    settings?.keymap?.palette === null
      ? null
      : (settings?.keymap?.palette ?? DEFAULT_KEYMAP.palette)
  const goToTabBinding =
    settings?.keymap?.goToTab === null
      ? null
      : (settings?.keymap?.goToTab ?? DEFAULT_KEYMAP.goToTab)
  const goToLastTabBinding =
    settings?.keymap?.goToLastTab === null
      ? null
      : (settings?.keymap?.goToLastTab ?? DEFAULT_KEYMAP.goToLastTab)
  const goToShellBinding =
    settings?.keymap?.goToShell === null
      ? null
      : (settings?.keymap?.goToShell ?? DEFAULT_KEYMAP.goToShell)
  const prevShellBinding =
    settings?.keymap?.prevShell === null
      ? null
      : (settings?.keymap?.prevShell ?? DEFAULT_KEYMAP.prevShell)
  const nextShellBinding =
    settings?.keymap?.nextShell === null
      ? null
      : (settings?.keymap?.nextShell ?? DEFAULT_KEYMAP.nextShell)
  const togglePipBinding =
    settings?.keymap?.togglePip === null
      ? null
      : (settings?.keymap?.togglePip ?? DEFAULT_KEYMAP.togglePip)
  const itemActionsBinding =
    settings?.keymap?.itemActions === null
      ? null
      : (settings?.keymap?.itemActions ?? DEFAULT_KEYMAP.itemActions)
  const collapseAllBinding =
    settings?.keymap?.collapseAll === null
      ? null
      : (settings?.keymap?.collapseAll ?? DEFAULT_KEYMAP.collapseAll)
  const settingsBinding =
    settings?.keymap?.settings === null
      ? null
      : (settings?.keymap?.settings ?? DEFAULT_KEYMAP.settings)
  const newShellBinding =
    settings?.keymap?.newShell === null
      ? null
      : (settings?.keymap?.newShell ?? DEFAULT_KEYMAP.newShell)
  const closeShellBinding =
    settings?.keymap?.closeShell === null
      ? null
      : (settings?.keymap?.closeShell ?? DEFAULT_KEYMAP.closeShell)
  const commitAmendBinding =
    settings?.keymap?.commitAmend === null
      ? null
      : (settings?.keymap?.commitAmend ?? DEFAULT_KEYMAP.commitAmend)
  const commitNoVerifyBinding =
    settings?.keymap?.commitNoVerify === null
      ? null
      : (settings?.keymap?.commitNoVerify ?? DEFAULT_KEYMAP.commitNoVerify)
  const shellTemplatesBinding =
    settings?.keymap?.shellTemplates === null
      ? null
      : (settings?.keymap?.shellTemplates ?? DEFAULT_KEYMAP.shellTemplates)

  useEffect(() => {
    let modifierBuffer: ModifierBuffer = {
      meta: false,
      ctrl: false,
      alt: false,
      shift: false,
    }
    let active = false
    let firedNonModifier = false

    function reset() {
      modifierBuffer = { meta: false, ctrl: false, alt: false, shift: false }
      active = false
      firedNonModifier = false
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return

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
        // Skip key-repeat events; fire once per discrete keypress
        if (e.repeat) return
        firedNonModifier = true

        const h = handlersRef.current
        // On macOS, Alt+key produces special characters (e.g. Alt+A → å).
        // Use e.code to get the physical key when Alt is held.
        const key =
          modifierBuffer.alt && e.code.startsWith('Key')
            ? e.code[3].toLowerCase()
            : e.key.toLowerCase()

        // Helper to match a key-based binding
        const matchKey = (
          binding: ShortcutBinding | null,
        ): binding is ShortcutBinding =>
          !!binding?.key &&
          modifiersMatchBinding(modifierBuffer, binding) &&
          key === binding.key

        if (h.palette && matchKey(paletteBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.palette(new KeyboardEvent('keydown'))
          return
        }

        if (h.togglePip && matchKey(togglePipBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.togglePip()
          return
        }

        if (h.itemActions && matchKey(itemActionsBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.itemActions()
          return
        }

        if (h.collapseAll && matchKey(collapseAllBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.collapseAll()
          return
        }

        if (h.settings && matchKey(settingsBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.settings()
          return
        }

        if (h.commitAmend && matchKey(commitAmendBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.commitAmend()
          return
        }

        if (
          h.newShell &&
          matchKey(newShellBinding) &&
          !commitDialogOpenRef.current
        ) {
          e.preventDefault()
          e.stopPropagation()
          h.newShell()
          return
        }

        if (h.closeShell && matchKey(closeShellBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.closeShell()
          return
        }

        if (h.commitNoVerify && matchKey(commitNoVerifyBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.commitNoVerify()
          return
        }

        if (h.shellTemplates && matchKey(shellTemplatesBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.shellTemplates()
          return
        }

        if (h.prevShell && matchKey(prevShellBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.prevShell()
          return
        }

        if (h.nextShell && matchKey(nextShellBinding)) {
          e.preventDefault()
          e.stopPropagation()
          h.nextShell()
          return
        }

        // Check goToTab / goToShell: modifiers match + physical digit key pressed
        const digit =
          e.code >= 'Digit0' && e.code <= 'Digit9' ? e.code[5] : null
        if (digit) {
          if (
            h.goToTab &&
            goToTabBinding &&
            modifiersMatchBinding(modifierBuffer, goToTabBinding)
          ) {
            e.preventDefault()
            e.stopPropagation()
            h.goToTab(Number.parseInt(digit, 10))
          } else if (
            h.goToShell &&
            goToShellBinding &&
            modifiersMatchBinding(modifierBuffer, goToShellBinding)
          ) {
            e.preventDefault()
            e.stopPropagation()
            h.goToShell(Number.parseInt(digit, 10))
          }
        }

        return
      }

      // Plain key with no modifiers held: check for modifier-free palette binding
      const h = handlersRef.current
      if (
        h.palette &&
        paletteBinding &&
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

    const handleKeyUp = (_e: KeyboardEvent) => {
      if (!active) return

      // When all modifiers released, check for modifier-only goToLastTab
      if (
        !heldState.meta &&
        !heldState.ctrl &&
        !heldState.alt &&
        !heldState.shift
      ) {
        if (
          !firedNonModifier &&
          goToLastTabBinding &&
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
  }, [
    paletteBinding,
    goToTabBinding,
    goToLastTabBinding,
    goToShellBinding,
    prevShellBinding,
    nextShellBinding,
    togglePipBinding,
    itemActionsBinding,
    collapseAllBinding,
    settingsBinding,
    newShellBinding,
    closeShellBinding,
    commitAmendBinding,
    commitNoVerifyBinding,
    shellTemplatesBinding,
    pip.window,
  ])
}
