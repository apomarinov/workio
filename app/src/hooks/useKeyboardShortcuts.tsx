import { ArrowBigUp, ChevronUp, Command, Option } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Options } from 'react-hotkeys-hook'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  bindingToHotkeyString,
  DEFAULT_KEYMAP,
  type Keymap,
  type ShortcutBinding,
} from '../types'
import { useSettings } from './useSettings'

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

// --- useKeyboardShortcuts: registers handlers via react-hotkeys-hook ---

interface KeymapHandlers {
  palette?: (e: KeyboardEvent) => void
  goToTab?: (index: number) => void
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
  customCommands?: () => void
}

function resolveBinding(
  keymap: Keymap | undefined,
  name: keyof Keymap,
): ShortcutBinding | null {
  if (!keymap) return DEFAULT_KEYMAP[name]
  return keymap[name] === null ? null : (keymap[name] ?? DEFAULT_KEYMAP[name])
}

const HOTKEY_OPTS: Options = {
  enableOnFormTags: true,
  eventListenerOptions: { capture: true },
  preventDefault: true,
}

export function useKeyboardShortcuts(handlers: KeymapHandlers) {
  const { settings } = useSettings()
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

  const keymap = settings?.keymap
  const paletteBinding = resolveBinding(keymap, 'palette')
  const goToTabBinding = resolveBinding(keymap, 'goToTab')
  const goToShellBinding = resolveBinding(keymap, 'goToShell')
  const prevShellBinding = resolveBinding(keymap, 'prevShell')
  const nextShellBinding = resolveBinding(keymap, 'nextShell')
  const togglePipBinding = resolveBinding(keymap, 'togglePip')
  const itemActionsBinding = resolveBinding(keymap, 'itemActions')
  const collapseAllBinding = resolveBinding(keymap, 'collapseAll')
  const settingsBinding = resolveBinding(keymap, 'settings')
  const newShellBinding = resolveBinding(keymap, 'newShell')
  const closeShellBinding = resolveBinding(keymap, 'closeShell')
  const commitAmendBinding = resolveBinding(keymap, 'commitAmend')
  const commitNoVerifyBinding = resolveBinding(keymap, 'commitNoVerify')
  const shellTemplatesBinding = resolveBinding(keymap, 'shellTemplates')
  const customCommandsBinding = resolveBinding(keymap, 'customCommands')

  // --- Standard key-based shortcuts (one useHotkeys per shortcut) ---

  // Palette: special handling for bare-key binding (no modifiers = skip form elements)
  useHotkeys(
    paletteBinding?.key ? bindingToHotkeyString(paletteBinding) : '',
    (e) => {
      if (disabledRef.current) return
      if (
        paletteBinding &&
        !paletteBinding.metaKey &&
        !paletteBinding.ctrlKey &&
        !paletteBinding.altKey &&
        !paletteBinding.shiftKey
      ) {
        const el = e.target as HTMLElement
        const tag = el?.tagName
        if (
          tag === 'INPUT' ||
          tag === 'SELECT' ||
          tag === 'TEXTAREA' ||
          el?.isContentEditable
        )
          return
      }
      e.stopPropagation()
      handlersRef.current.palette?.(e)
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    prevShellBinding?.key ? bindingToHotkeyString(prevShellBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.prevShell?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    nextShellBinding?.key ? bindingToHotkeyString(nextShellBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.nextShell?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    togglePipBinding?.key ? bindingToHotkeyString(togglePipBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.togglePip?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    itemActionsBinding?.key ? bindingToHotkeyString(itemActionsBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.itemActions?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    collapseAllBinding?.key ? bindingToHotkeyString(collapseAllBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.collapseAll?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    settingsBinding?.key ? bindingToHotkeyString(settingsBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.settings?.()
    },
    HOTKEY_OPTS,
  )

  // newShell: suppressed when commit dialog is open (shares default binding with commitNoVerify)
  useHotkeys(
    newShellBinding?.key ? bindingToHotkeyString(newShellBinding) : '',
    (e) => {
      if (disabledRef.current || commitDialogOpenRef.current) return
      e.stopPropagation()
      handlersRef.current.newShell?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    closeShellBinding?.key ? bindingToHotkeyString(closeShellBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.closeShell?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    commitAmendBinding?.key ? bindingToHotkeyString(commitAmendBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.commitAmend?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    commitNoVerifyBinding?.key
      ? bindingToHotkeyString(commitNoVerifyBinding)
      : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.commitNoVerify?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    shellTemplatesBinding?.key
      ? bindingToHotkeyString(shellTemplatesBinding)
      : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.shellTemplates?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    customCommandsBinding?.key
      ? bindingToHotkeyString(customCommandsBinding)
      : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.customCommands?.()
    },
    HOTKEY_OPTS,
  )

  // --- Digit shortcuts (goToTab / goToShell) ---
  // Custom listener because these match any digit key with specific modifier combination
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return
      if (e.code < 'Digit0' || e.code > 'Digit9') return
      const digit = Number.parseInt(e.code[5], 10)

      const modMatch = (binding: ShortcutBinding) =>
        e.metaKey === !!binding.metaKey &&
        e.ctrlKey === !!binding.ctrlKey &&
        e.altKey === !!binding.altKey &&
        e.shiftKey === !!binding.shiftKey

      if (
        goToTabBinding &&
        modMatch(goToTabBinding) &&
        handlersRef.current.goToTab
      ) {
        e.preventDefault()
        e.stopPropagation()
        handlersRef.current.goToTab(digit)
      } else if (
        goToShellBinding &&
        modMatch(goToShellBinding) &&
        handlersRef.current.goToShell
      ) {
        e.preventDefault()
        e.stopPropagation()
        handlersRef.current.goToShell(digit)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [goToTabBinding, goToShellBinding])

  // --- Tab key: focus terminal when pressed outside form elements ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      let xtermTextarea: HTMLTextAreaElement | null = null
      for (const ta of document.querySelectorAll('.xterm-helper-textarea')) {
        if (!ta.closest('.invisible')) {
          xtermTextarea = ta as HTMLTextAreaElement
          break
        }
      }
      if (!xtermTextarea) return
      if (document.activeElement === xtermTextarea) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      e.preventDefault()
      xtermTextarea.focus()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}
