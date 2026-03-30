import {
  DEFAULT_KEYMAP,
  type Keymap,
  type ShortcutBinding,
} from '@domains/settings/schema'
import { ArrowBigUp, ChevronUp, Command, Option } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Options } from 'react-hotkeys-hook'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSettings } from './useSettings'

function bindingToHotkeyString(b: ShortcutBinding): string {
  const parts: string[] = []
  if (b.ctrlKey) parts.push('ctrl')
  if (b.altKey) parts.push('alt')
  if (b.shiftKey) parts.push('shift')
  if (b.metaKey) parts.push('meta')
  if (b.key) parts.push(b.key)
  return parts.join('+')
}

// --- Module-level palette state tracking ---

let paletteState = { open: false, mode: '' }

function handlePaletteState(e: Event) {
  const detail = (e as CustomEvent).detail
  paletteState = { open: detail.open, mode: detail.mode }
}
window.addEventListener('palette-state', handlePaletteState)

// --- Module-level modifier tracking ---

type Side = 'left' | 'right' | null

interface HeldState {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  metaSide: Side
  ctrlSide: Side
  altSide: Side
  shiftSide: Side
}

const INITIAL_HELD: HeldState = {
  meta: false,
  ctrl: false,
  alt: false,
  shift: false,
  metaSide: null,
  ctrlSide: null,
  altSide: null,
  shiftSide: null,
}

let heldState: HeldState = { ...INITIAL_HELD }
let suppressHeld = false
const EMPTY_HELD: HeldState = { ...INITIAL_HELD }
const heldListeners = new Set<() => void>()

function emitHeld() {
  for (const l of heldListeners) l()
}

type ModName = 'meta' | 'ctrl' | 'alt' | 'shift'

const KEY_TO_MOD: Record<string, ModName> = {
  Meta: 'meta',
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
}

const CODE_TO_SIDE: Record<string, Side> = {
  MetaLeft: 'left',
  MetaRight: 'right',
  ControlLeft: 'left',
  ControlRight: 'right',
  AltLeft: 'left',
  AltRight: 'right',
  ShiftLeft: 'left',
  ShiftRight: 'right',
}

function handleModKeyDown(e: KeyboardEvent) {
  const mod = KEY_TO_MOD[e.key]
  if (!mod || heldState[mod]) return
  const side = CODE_TO_SIDE[e.code] ?? null
  heldState = { ...heldState, [mod]: true, [`${mod}Side`]: side }
  if (!suppressHeld) emitHeld()
}

function handleModKeyUp(e: KeyboardEvent) {
  const mod = KEY_TO_MOD[e.key]
  if (mod && heldState[mod]) {
    heldState = { ...heldState, [mod]: false, [`${mod}Side`]: null }
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
    heldState = { ...INITIAL_HELD }
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

/** Check if a modifier-only binding matches the held state, including optional side. */
function modifierBindingMatches(
  held: HeldState,
  binding: ShortcutBinding,
): boolean {
  if (
    held.meta !== !!binding.metaKey ||
    held.ctrl !== !!binding.ctrlKey ||
    held.alt !== !!binding.altKey ||
    held.shift !== !!binding.shiftKey
  )
    return false
  // Only check side for single-modifier bindings
  if (binding.side) {
    const modCount =
      +!!binding.metaKey +
      +!!binding.ctrlKey +
      +!!binding.altKey +
      +!!binding.shiftKey
    if (modCount === 1) {
      if (binding.metaKey && held.metaSide !== binding.side) return false
      if (binding.ctrlKey && held.ctrlSide !== binding.side) return false
      if (binding.altKey && held.altSide !== binding.side) return false
      if (binding.shiftKey && held.shiftSide !== binding.side) return false
    }
  }
  return true
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
  const paneDragBinding =
    settings?.keymap?.paneDrag === null
      ? null
      : (settings?.keymap?.paneDrag ?? DEFAULT_KEYMAP.paneDrag)

  const isGoToTabModifierHeld =
    goToTabBinding !== null && modifierBindingMatches(held, goToTabBinding)

  const isGoToShellModifierHeld =
    goToShellBinding !== null && modifierBindingMatches(held, goToShellBinding)

  const isPaneDragModifierHeld =
    paneDragBinding !== null && modifierBindingMatches(held, paneDragBinding)

  return {
    held,
    isGoToTabModifierHeld,
    isGoToShellModifierHeld,
    isPaneDragModifierHeld,
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
  branches?: () => void
  pullBranch?: () => void
  splitRight?: () => void
  splitDown?: () => void
  toggleSidebar?: () => void
  commit?: () => void
}

function resolveBinding(
  keymap: Keymap | undefined,
  name: keyof Keymap,
): ShortcutBinding | null {
  if (!keymap) return DEFAULT_KEYMAP[name]
  return keymap[name] === null ? null : (keymap[name] ?? DEFAULT_KEYMAP[name])
}

function focusableXterm(): HTMLTextAreaElement | null {
  for (const ta of document.querySelectorAll('.xterm-helper-textarea')) {
    if (!ta.closest('.invisible')) return ta as HTMLTextAreaElement
  }
  return null
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
  const dialogOpenCountRef = useRef(0)

  useEffect(() => {
    const onDisable = (e: Event) => {
      disabledRef.current = (e as CustomEvent).detail
    }
    const onCommitDialog = (e: Event) => {
      commitDialogOpenRef.current = (e as CustomEvent).detail
    }
    const onDialogOpened = () => {
      dialogOpenCountRef.current++
    }
    const onDialogClosed = () => {
      dialogOpenCountRef.current = Math.max(0, dialogOpenCountRef.current - 1)
    }
    window.addEventListener('shortcuts-disabled', onDisable)
    window.addEventListener('commit-dialog-open', onCommitDialog)
    window.addEventListener('dialog-opened', onDialogOpened)
    window.addEventListener('dialog-closed', onDialogClosed)
    return () => {
      window.removeEventListener('shortcuts-disabled', onDisable)
      window.removeEventListener('commit-dialog-open', onCommitDialog)
      window.removeEventListener('dialog-opened', onDialogOpened)
      window.removeEventListener('dialog-closed', onDialogClosed)
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
  const branchesBinding = resolveBinding(keymap, 'branches')
  const pullBranchBinding = resolveBinding(keymap, 'pullBranch')
  const splitRightBinding = resolveBinding(keymap, 'splitRight')
  const splitDownBinding = resolveBinding(keymap, 'splitDown')
  const toggleSidebarBinding = resolveBinding(keymap, 'toggleSidebar')
  const commitBinding = resolveBinding(keymap, 'commit')

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
      if (disabledRef.current || commitDialogOpenRef.current) return
      e.stopPropagation()
      handlersRef.current.customCommands?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    branchesBinding?.key ? bindingToHotkeyString(branchesBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.branches?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    pullBranchBinding?.key ? bindingToHotkeyString(pullBranchBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.pullBranch?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    splitRightBinding?.key ? bindingToHotkeyString(splitRightBinding) : '',
    (e) => {
      if (disabledRef.current || dialogOpenCountRef.current > 0 || commitDialogOpenRef.current) return
      e.stopPropagation()
      handlersRef.current.splitRight?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    splitDownBinding?.key ? bindingToHotkeyString(splitDownBinding) : '',
    (e) => {
      if (disabledRef.current || dialogOpenCountRef.current > 0 || commitDialogOpenRef.current) return
      e.stopPropagation()
      handlersRef.current.splitDown?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    toggleSidebarBinding?.key
      ? bindingToHotkeyString(toggleSidebarBinding)
      : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.toggleSidebar?.()
    },
    HOTKEY_OPTS,
  )

  useHotkeys(
    commitBinding?.key ? bindingToHotkeyString(commitBinding) : '',
    (e) => {
      if (disabledRef.current) return
      e.stopPropagation()
      handlersRef.current.commit?.()
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

      if (goToTabBinding && modMatch(goToTabBinding)) {
        if (paletteState.open) {
          // Suppress goToTab when palette is open; dispatch selection for custom-commands
          e.preventDefault()
          e.stopPropagation()
          if (paletteState.mode === 'custom-commands' && digit >= 1) {
            window.dispatchEvent(
              new CustomEvent('palette-select-index', {
                detail: { index: digit },
              }),
            )
          }
          return
        }
        if (handlersRef.current.goToTab) {
          e.preventDefault()
          e.stopPropagation()
          handlersRef.current.goToTab(digit)
        }
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
      if (document.activeElement === focusableXterm()) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      e.preventDefault()
      focusableXterm()?.focus()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // --- Refocus active shell when any dialog/modal closes ---
  useEffect(() => {
    const handleDialogClosed = () => {
      setTimeout(() => focusableXterm()?.focus(), 50)
    }
    window.addEventListener('dialog-closed', handleDialogClosed)
    return () => window.removeEventListener('dialog-closed', handleDialogClosed)
  }, [])
}
