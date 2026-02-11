import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronUp,
  Command,
  Option,
  RotateCcw,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { useSettings } from '../hooks/useSettings'
import { DEFAULT_KEYMAP, type ShortcutBinding } from '../types'

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])
const MOD_MAP: Record<string, 'meta' | 'ctrl' | 'alt' | 'shift'> = {
  Meta: 'meta',
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
}

// Apple convention: Control → Option → Shift → Command, then non-modifiers
const KEY_ORDER: Record<string, number> = {
  Control: 0,
  Alt: 1,
  Shift: 2,
  Meta: 3,
}

const ICON_CLASS = 'inline-block w-3 h-3 align-[-2px]'

function renderKey(key: string): ReactNode {
  const cls = cn(ICON_CLASS, 'stroke-3')
  if (key === 'Meta') return <Command className={cls} />
  if (key === 'Control') return <ChevronUp className={cls} />
  if (key === 'Alt') return <Option className={cls} />
  if (key === 'Shift') return <ArrowBigUp className={cls} />
  if (key === 'ArrowUp') return <ArrowUp className={cls} />
  if (key === 'ArrowDown') return <ArrowDown className={cls} />
  if (key === 'ArrowLeft') return <ArrowLeft className={cls} />
  if (key === 'ArrowRight') return <ArrowRight className={cls} />
  return <span>{key.toUpperCase()}</span>
}

function formatKeyDisplay(key: string): ReactNode {
  const cls = cn(ICON_CLASS, 'stroke-3')
  if (key === 'arrowup') return <ArrowUp className={cls} />
  if (key === 'arrowdown') return <ArrowDown className={cls} />
  if (key === 'arrowleft') return <ArrowLeft className={cls} />
  if (key === 'arrowright') return <ArrowRight className={cls} />
  return <span>{key.toUpperCase()}</span>
}

function formatBinding(
  binding: ShortcutBinding | null,
  suffix?: string,
): ReactNode {
  if (!binding) {
    return <span className="text-muted-foreground italic">Disabled</span>
  }
  return (
    <span className="inline-flex items-center gap-1">
      {binding.ctrlKey && <ChevronUp className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.altKey && <Option className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.shiftKey && (
        <ArrowBigUp className={cn(ICON_CLASS, 'stroke-3')} />
      )}
      {binding.metaKey && <Command className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.key && formatKeyDisplay(binding.key)}
      {suffix && <span>{suffix}</span>}
    </span>
  )
}

function bindingsConflict(
  palette: ShortcutBinding | null,
  goToTab: ShortcutBinding | null,
): boolean {
  if (!palette || !goToTab) return false
  if (!palette.key) return false
  const isAllDigits = palette.key.split('').every((c) => c >= '0' && c <= '9')
  if (!isAllDigits) return false
  return (
    !!palette.metaKey === !!goToTab.metaKey &&
    !!palette.ctrlKey === !!goToTab.ctrlKey &&
    !!palette.altKey === !!goToTab.altKey &&
    !!palette.shiftKey === !!goToTab.shiftKey
  )
}

type ShortcutName =
  | 'palette'
  | 'goToTab'
  | 'goToLastTab'
  | 'togglePip'
  | 'itemActions'
  | 'collapseAll'
  | 'settings'

function findDuplicates(
  bindings: Record<ShortcutName, ShortcutBinding | null>,
): Set<ShortcutName> {
  const duplicates = new Set<ShortcutName>()
  const keys = Object.keys(bindings) as ShortcutName[]

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = bindings[keys[i]]
      const b = bindings[keys[j]]
      // Skip if either is null or modifier-only (no key)
      if (!a || !b || !a.key || !b.key) continue
      if (bindingsEqual(a, b)) {
        duplicates.add(keys[i])
        duplicates.add(keys[j])
      }
    }
  }

  return duplicates
}

interface KeymapModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeymapModal({ open, onOpenChange }: KeymapModalProps) {
  const { settings, updateSettings } = useSettings()

  // Disable global shortcuts while modal is open
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('shortcuts-disabled', { detail: open }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('shortcuts-disabled', { detail: false }),
      )
    }
  }, [open])

  const [palette, setPalette] = useState<ShortcutBinding | null>(
    DEFAULT_KEYMAP.palette,
  )
  const [goToTab, setGoToTab] = useState<ShortcutBinding | null>(
    DEFAULT_KEYMAP.goToTab,
  )
  const [goToLastTab, setGoToLastTab] = useState<ShortcutBinding | null>(
    DEFAULT_KEYMAP.goToLastTab,
  )
  const [togglePip, setTogglePip] = useState<ShortcutBinding | null>(
    DEFAULT_KEYMAP.togglePip,
  )
  const [itemActions, setItemActions] = useState<ShortcutBinding | null>(
    DEFAULT_KEYMAP.itemActions,
  )
  const [collapseAll, setCollapseAll] = useState<ShortcutBinding | null>(
    DEFAULT_KEYMAP.collapseAll,
  )
  const [settingsShortcut, setSettingsShortcut] =
    useState<ShortcutBinding | null>(DEFAULT_KEYMAP.settings)
  const [recording, setRecording] = useState<
    | 'palette'
    | 'goToTab'
    | 'goToLastTab'
    | 'togglePip'
    | 'itemActions'
    | 'collapseAll'
    | 'settings'
    | null
  >(null)
  const [recordingKeys, setRecordingKeys] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)

  // Check if current state differs from saved settings
  const hasUnsavedChanges = useMemo(() => {
    const saved = settings?.keymap
    const savedPalette = saved?.palette ?? DEFAULT_KEYMAP.palette
    const savedGoToTab = saved?.goToTab ?? DEFAULT_KEYMAP.goToTab
    const savedGoToLastTab = saved?.goToLastTab ?? DEFAULT_KEYMAP.goToLastTab
    const savedTogglePip = saved?.togglePip ?? DEFAULT_KEYMAP.togglePip
    const savedItemActions = saved?.itemActions ?? DEFAULT_KEYMAP.itemActions
    const savedCollapseAll = saved?.collapseAll ?? DEFAULT_KEYMAP.collapseAll
    const savedSettings = saved?.settings ?? DEFAULT_KEYMAP.settings

    return (
      !bindingsEqual(palette, savedPalette) ||
      !bindingsEqual(goToTab, savedGoToTab) ||
      !bindingsEqual(goToLastTab, savedGoToLastTab) ||
      !bindingsEqual(togglePip, savedTogglePip) ||
      !bindingsEqual(itemActions, savedItemActions) ||
      !bindingsEqual(collapseAll, savedCollapseAll) ||
      !bindingsEqual(settingsShortcut, savedSettings)
    )
  }, [
    settings?.keymap,
    palette,
    goToTab,
    goToLastTab,
    togglePip,
    itemActions,
    collapseAll,
    settingsShortcut,
  ])

  const handleClose = (newOpen: boolean) => {
    if (!newOpen && hasUnsavedChanges) {
      setShowConfirmClose(true)
      return
    }
    onOpenChange(newOpen)
  }

  const handleDiscardChanges = () => {
    setShowConfirmClose(false)
    // Reset to saved values
    const saved = settings?.keymap
    setPalette(saved?.palette ?? DEFAULT_KEYMAP.palette)
    setGoToTab(saved?.goToTab ?? DEFAULT_KEYMAP.goToTab)
    setGoToLastTab(saved?.goToLastTab ?? DEFAULT_KEYMAP.goToLastTab)
    setTogglePip(saved?.togglePip ?? DEFAULT_KEYMAP.togglePip)
    setItemActions(saved?.itemActions ?? DEFAULT_KEYMAP.itemActions)
    setCollapseAll(saved?.collapseAll ?? DEFAULT_KEYMAP.collapseAll)
    setSettingsShortcut(saved?.settings ?? DEFAULT_KEYMAP.settings)
    onOpenChange(false)
  }

  useEffect(() => {
    if (settings?.keymap) {
      setPalette(settings.keymap.palette)
      setGoToTab(settings.keymap.goToTab)
      if (settings.keymap.goToLastTab !== undefined) {
        setGoToLastTab(settings.keymap.goToLastTab)
      }
      if (settings.keymap.togglePip !== undefined) {
        setTogglePip(settings.keymap.togglePip)
      }
      if (settings.keymap.itemActions !== undefined) {
        setItemActions(settings.keymap.itemActions)
      }
      if (settings.keymap.collapseAll !== undefined) {
        setCollapseAll(settings.keymap.collapseAll)
      }
      if (settings.keymap.settings !== undefined) {
        setSettingsShortcut(settings.keymap.settings)
      }
    }
  }, [settings?.keymap])

  useEffect(() => {
    if (!recording) return
    setRecordingKeys([])

    const heldMods = new Set<string>()
    const heldNonModKeys = new Set<string>()
    let modifierBuffer = { meta: false, ctrl: false, alt: false, shift: false }
    const keyBuffer: string[] = []
    let active = false

    function finalize() {
      const binding: ShortcutBinding = {}
      if (modifierBuffer.meta) binding.metaKey = true
      if (modifierBuffer.ctrl) binding.ctrlKey = true
      if (modifierBuffer.alt) binding.altKey = true
      if (modifierBuffer.shift) binding.shiftKey = true

      if (recording === 'palette') {
        if (keyBuffer.length > 0) {
          binding.key = keyBuffer.join('')
        }
        setPalette(binding)
      } else if (recording === 'goToTab') {
        setGoToTab(binding)
      } else if (recording === 'goToLastTab') {
        setGoToLastTab(binding)
      } else if (recording === 'togglePip') {
        if (keyBuffer.length > 0) {
          binding.key = keyBuffer.join('')
        }
        setTogglePip(binding)
      } else if (recording === 'itemActions') {
        if (keyBuffer.length > 0) {
          binding.key = keyBuffer.join('')
        }
        setItemActions(binding)
      } else if (recording === 'collapseAll') {
        if (keyBuffer.length > 0) {
          binding.key = keyBuffer.join('')
        }
        setCollapseAll(binding)
      } else if (recording === 'settings') {
        if (keyBuffer.length > 0) {
          binding.key = keyBuffer.join('')
        }
        setSettingsShortcut(binding)
      }

      setRecording(null)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.repeat) return

      if (e.key === 'Escape') {
        setRecording(null)
        return
      }

      if (MODIFIER_KEYS.has(e.key)) {
        if (heldMods.has(e.key)) return
        heldMods.add(e.key)
        const mod = MOD_MAP[e.key]
        if (mod) {
          modifierBuffer = { ...modifierBuffer, [mod]: true }
          active = true
        }
        setRecordingKeys((prev) => [...prev, e.key])
        return
      }

      // Non-modifier key with no modifiers held: record immediately
      if (!active) {
        setRecordingKeys([e.key])
        if (recording === 'palette') {
          setPalette({ key: e.key.toLowerCase() })
        } else if (recording === 'goToTab') {
          setGoToTab({})
        } else if (recording === 'goToLastTab') {
          setGoToLastTab({})
        } else if (recording === 'togglePip') {
          setTogglePip({ key: e.key.toLowerCase() })
        } else if (recording === 'itemActions') {
          setItemActions({ key: e.key.toLowerCase() })
        } else if (recording === 'collapseAll') {
          setCollapseAll({ key: e.key.toLowerCase() })
        } else if (recording === 'settings') {
          setSettingsShortcut({ key: e.key.toLowerCase() })
        }
        setRecording(null)
        return
      }

      // For modifier-only shortcuts, finalize immediately on any non-modifier key
      if (!DEFAULT_KEYMAP[recording]?.key) {
        finalize()
        return
      }

      // Non-modifier key while modifiers are held: buffer if not already held
      if (heldNonModKeys.has(e.key)) return
      heldNonModKeys.add(e.key)
      keyBuffer.push(e.key.toLowerCase())
      setRecordingKeys((prev) => [...prev, e.key])
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) {
        heldMods.delete(e.key)
      } else {
        heldNonModKeys.delete(e.key)
      }
      setRecordingKeys((prev) => prev.filter((k) => k !== e.key))
      if (active && heldMods.size === 0) {
        finalize()
      }
    }

    const onBlur = () => {
      if (active) {
        setRecording(null)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings({
        keymap: {
          palette,
          goToTab,
          goToLastTab,
          togglePip,
          itemActions,
          collapseAll,
          settings: settingsShortcut,
        },
      })
      toast.success('Keyboard shortcuts saved')
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save shortcuts',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setPalette(DEFAULT_KEYMAP.palette)
    setGoToTab(DEFAULT_KEYMAP.goToTab)
    setGoToLastTab(DEFAULT_KEYMAP.goToLastTab)
    setTogglePip(DEFAULT_KEYMAP.togglePip)
    setItemActions(DEFAULT_KEYMAP.itemActions)
    setCollapseAll(DEFAULT_KEYMAP.collapseAll)
    setSettingsShortcut(DEFAULT_KEYMAP.settings)
    setRecording(null)
  }

  const hasConflict = bindingsConflict(palette, goToTab)
  const duplicates = useMemo(
    () =>
      findDuplicates({
        palette,
        goToTab,
        goToLastTab,
        togglePip,
        itemActions,
        collapseAll,
        settings: settingsShortcut,
      }),
    [
      palette,
      goToTab,
      goToLastTab,
      togglePip,
      itemActions,
      collapseAll,
      settingsShortcut,
    ],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="bg-sidebar sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <ShortcutRow
              label="Command Palette"
              binding={palette}
              isRecording={recording === 'palette'}
              recordingKeys={recording === 'palette' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'palette' ? null : 'palette')
              }
              onReset={() => setPalette(DEFAULT_KEYMAP.palette)}
              onUnset={() => setPalette(null)}
              defaultBinding={DEFAULT_KEYMAP.palette}
              display={formatBinding(palette)}
              hasConflict={hasConflict || duplicates.has('palette')}
            />
            <ShortcutRow
              label="Go to project"
              binding={goToTab}
              isRecording={recording === 'goToTab'}
              recordingKeys={recording === 'goToTab' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'goToTab' ? null : 'goToTab')
              }
              onReset={() => setGoToTab(DEFAULT_KEYMAP.goToTab)}
              onUnset={() => setGoToTab(null)}
              defaultBinding={DEFAULT_KEYMAP.goToTab}
              display={formatBinding(goToTab, goToTab ? '1 - 99' : undefined)}
              hasConflict={duplicates.has('goToTab')}
            />
            <ShortcutRow
              label="Go to last project"
              binding={goToLastTab}
              isRecording={recording === 'goToLastTab'}
              recordingKeys={recording === 'goToLastTab' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'goToLastTab' ? null : 'goToLastTab')
              }
              onReset={() => setGoToLastTab(DEFAULT_KEYMAP.goToLastTab)}
              onUnset={() => setGoToLastTab(null)}
              defaultBinding={DEFAULT_KEYMAP.goToLastTab}
              display={formatBinding(goToLastTab)}
              hasConflict={duplicates.has('goToLastTab')}
            />
            <ShortcutRow
              label="Toggle PiP Window"
              binding={togglePip}
              isRecording={recording === 'togglePip'}
              recordingKeys={recording === 'togglePip' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'togglePip' ? null : 'togglePip')
              }
              onReset={() => setTogglePip(DEFAULT_KEYMAP.togglePip)}
              onUnset={() => setTogglePip(null)}
              defaultBinding={DEFAULT_KEYMAP.togglePip}
              display={formatBinding(togglePip)}
              hasConflict={duplicates.has('togglePip')}
            />
            <ShortcutRow
              label="Project Actions"
              binding={itemActions}
              isRecording={recording === 'itemActions'}
              recordingKeys={recording === 'itemActions' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'itemActions' ? null : 'itemActions')
              }
              onReset={() => setItemActions(DEFAULT_KEYMAP.itemActions)}
              onUnset={() => setItemActions(null)}
              defaultBinding={DEFAULT_KEYMAP.itemActions}
              display={formatBinding(itemActions)}
              hasConflict={duplicates.has('itemActions')}
            />
            <ShortcutRow
              label="Collapse All"
              binding={collapseAll}
              isRecording={recording === 'collapseAll'}
              recordingKeys={recording === 'collapseAll' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'collapseAll' ? null : 'collapseAll')
              }
              onReset={() => setCollapseAll(DEFAULT_KEYMAP.collapseAll)}
              onUnset={() => setCollapseAll(null)}
              defaultBinding={DEFAULT_KEYMAP.collapseAll}
              display={formatBinding(collapseAll)}
              hasConflict={duplicates.has('collapseAll')}
            />
            <ShortcutRow
              label="Settings"
              binding={settingsShortcut}
              isRecording={recording === 'settings'}
              recordingKeys={recording === 'settings' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'settings' ? null : 'settings')
              }
              onReset={() => setSettingsShortcut(DEFAULT_KEYMAP.settings)}
              onUnset={() => setSettingsShortcut(null)}
              hasConflict={duplicates.has('settings')}
              defaultBinding={DEFAULT_KEYMAP.settings}
              display={formatBinding(settingsShortcut)}
            />
          </div>

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reset to Default
            </Button>
            <Button type="button" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmClose} onOpenChange={setShowConfirmClose}>
        <AlertDialogContent className="bg-sidebar">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDiscardChanges}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function bindingsEqual(
  a: ShortcutBinding | null,
  b: ShortcutBinding | null,
): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return (
    !!a.metaKey === !!b.metaKey &&
    !!a.ctrlKey === !!b.ctrlKey &&
    !!a.altKey === !!b.altKey &&
    !!a.shiftKey === !!b.shiftKey &&
    (a.key ?? '') === (b.key ?? '')
  )
}

function ShortcutRow({
  label,
  isRecording,
  recordingKeys,
  onRecord,
  onReset,
  onUnset,
  binding,
  defaultBinding,
  display,
  hasConflict,
}: {
  label: string
  binding: ShortcutBinding | null
  defaultBinding: ShortcutBinding | null
  isRecording: boolean
  recordingKeys: string[]
  onRecord: () => void
  onReset: () => void
  onUnset: () => void
  display: ReactNode
  hasConflict?: boolean
}) {
  const isDisabled = !binding
  const isDefault = bindingsEqual(binding, defaultBinding)
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium flex flex-col gap-0">
        {label}
        {binding && !binding.key && (
          <span className="text-xs font-normal text-muted-foreground">
            Modifier only
          </span>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRecord}
          className={cn(
            'px-3 py-1.5 cursor-pointer text-sm font-mono rounded-md border transition-colors',
            isRecording
              ? 'border-primary bg-primary/10 text-primary animate-pulse'
              : hasConflict
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                : isDisabled
                  ? 'border-border bg-zinc-800/50 text-muted-foreground hover:bg-zinc-700/70'
                  : 'border-border bg-zinc-800 hover:bg-zinc-700/70',
          )}
        >
          {isRecording ? (
            recordingKeys.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                {[...recordingKeys]
                  .sort((a, b) => (KEY_ORDER[a] ?? 4) - (KEY_ORDER[b] ?? 4))
                  .map((key, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable sorted list
                    <span key={i}>{renderKey(key)}</span>
                  ))}
              </span>
            ) : (
              'Press shortcut...'
            )
          ) : (
            display
          )}
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="p-1.5 cursor-pointer text-muted-foreground hover:text-foreground rounded-md border border-border bg-zinc-800 hover:bg-zinc-700/70 transition-colors"
            title="Reset to default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {!isDisabled && (
          <button
            type="button"
            onClick={onUnset}
            className="p-1.5 cursor-pointer text-muted-foreground hover:text-foreground rounded-md border border-border bg-zinc-800 hover:bg-zinc-700/70 transition-colors"
            title="Disable shortcut"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
