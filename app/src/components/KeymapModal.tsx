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
import {
  CODE_TO_DISPLAY,
  DEFAULT_KEYMAP,
  type Keymap,
  mapEventCode,
  type ShortcutBinding,
} from '../types'
import { ConfirmModal } from './ConfirmModal'

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])
const MOD_MAP: Record<string, 'meta' | 'ctrl' | 'alt' | 'shift'> = {
  Meta: 'meta',
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
}

// Convert e.code to a display-friendly key name for the recording preview.
// On macOS, Alt+key produces special chars in e.key (e.g. Dead, ˜, å),
// so we derive the display from e.code which always gives the physical key.
function codeToPreviewKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3) // KeyA → A
  if (code.startsWith('Digit')) return code.slice(5) // Digit1 → 1
  if (code.startsWith('Arrow')) return code // ArrowUp → ArrowUp (renderKey handles icons)
  const normalized = code.toLowerCase()
  return CODE_TO_DISPLAY[normalized] ?? code
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
  // Map code-based names to display characters
  const display = CODE_TO_DISPLAY[key]
  if (display) return <span>{display.toUpperCase()}</span>
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

type ShortcutName = keyof Keymap

// Pairs that intentionally share a binding (context-dependent shortcuts)
const ALLOWED_DUPLICATE_PAIRS = new Set([
  'commitNoVerify:newShell',
  'newShell:commitNoVerify',
  'commitAmend:customCommands',
  'customCommands:commitAmend',
])

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
      // Skip allowed duplicate pairs (context-dependent)
      if (ALLOWED_DUPLICATE_PAIRS.has(`${keys[i]}:${keys[j]}`)) continue
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

  // Single state object for all bindings
  const [bindings, setBindings] = useState<
    Record<ShortcutName, ShortcutBinding | null>
  >({ ...DEFAULT_KEYMAP })

  const setBinding = (name: ShortcutName, value: ShortcutBinding | null) => {
    setBindings((prev) => ({ ...prev, [name]: value }))
  }

  const [recording, setRecording] = useState<ShortcutName | null>(null)
  const [recordingKeys, setRecordingKeys] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)

  // Check if current state differs from saved settings
  const hasUnsavedChanges = useMemo(() => {
    const saved = settings?.keymap
    for (const name of Object.keys(DEFAULT_KEYMAP) as ShortcutName[]) {
      const savedBinding = saved?.[name] ?? DEFAULT_KEYMAP[name]
      if (!bindingsEqual(bindings[name], savedBinding)) return true
    }
    return false
  }, [settings?.keymap, bindings])

  const handleClose = (newOpen: boolean) => {
    if (!newOpen && hasUnsavedChanges) {
      setShowConfirmClose(true)
      return
    }
    onOpenChange(newOpen)
  }

  const handleDiscardChanges = () => {
    setShowConfirmClose(false)
    const saved = settings?.keymap
    const restored = {} as Record<ShortcutName, ShortcutBinding | null>
    for (const name of Object.keys(DEFAULT_KEYMAP) as ShortcutName[]) {
      restored[name] = saved?.[name] ?? DEFAULT_KEYMAP[name]
    }
    setBindings(restored)
    onOpenChange(false)
  }

  // Sync from settings when they load/change
  useEffect(() => {
    if (settings?.keymap) {
      const updated = {} as Record<ShortcutName, ShortcutBinding | null>
      for (const name of Object.keys(DEFAULT_KEYMAP) as ShortcutName[]) {
        updated[name] =
          settings.keymap[name] !== undefined
            ? settings.keymap[name]
            : DEFAULT_KEYMAP[name]
      }
      setBindings(updated)
    }
  }, [settings?.keymap])

  // Recording effect
  useEffect(() => {
    if (!recording) return
    setRecordingKeys([])

    const heldMods = new Set<string>()
    let modifierBuffer = { meta: false, ctrl: false, alt: false, shift: false }
    const keyBuffer: string[] = []
    let active = false

    function finalize() {
      if (!recording) return
      const binding: ShortcutBinding = {}
      if (modifierBuffer.meta) binding.metaKey = true
      if (modifierBuffer.ctrl) binding.ctrlKey = true
      if (modifierBuffer.alt) binding.altKey = true
      if (modifierBuffer.shift) binding.shiftKey = true

      if (keyBuffer.length > 0) {
        binding.key = keyBuffer.join('')
      }
      setBinding(recording, binding)
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
        setRecordingKeys([codeToPreviewKey(e.code)])
        // Modifier-only shortcuts (goToTab, goToShell) get empty binding on bare key
        if (!DEFAULT_KEYMAP[recording]?.key) {
          setBinding(recording, {})
        } else {
          setBinding(recording, { key: mapEventCode(e.code) })
        }
        setRecording(null)
        return
      }

      // For modifier-only shortcuts, finalize immediately on any non-modifier key
      if (!DEFAULT_KEYMAP[recording]?.key) {
        finalize()
        return
      }

      // Non-modifier key while modifiers are held: finalize immediately
      // (multi-key bindings like Alt+IAB can't be matched, so only accept one key)
      keyBuffer.push(mapEventCode(e.code))
      setRecordingKeys((prev) => [...prev, codeToPreviewKey(e.code)])
      finalize()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(e.key)) return
      heldMods.delete(e.key)
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
      await updateSettings({ keymap: bindings as Keymap })
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
    setBindings({ ...DEFAULT_KEYMAP })
    setRecording(null)
  }

  const hasConflict = bindingsConflict(bindings.palette, bindings.goToTab)
  const duplicates = useMemo(() => findDuplicates(bindings), [bindings])

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="bg-sidebar sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5 max-h-[75vh] overflow-y-auto pr-1">
            <ShortcutRow
              label="Command Palette"
              binding={bindings.palette}
              isRecording={recording === 'palette'}
              recordingKeys={recording === 'palette' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'palette' ? null : 'palette')
              }
              onReset={() => setBinding('palette', DEFAULT_KEYMAP.palette)}
              onUnset={() => setBinding('palette', null)}
              defaultBinding={DEFAULT_KEYMAP.palette}
              display={formatBinding(bindings.palette)}
              hasConflict={hasConflict || duplicates.has('palette')}
            />
            <ShortcutRow
              label="Go to project"
              binding={bindings.goToTab}
              isRecording={recording === 'goToTab'}
              recordingKeys={recording === 'goToTab' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'goToTab' ? null : 'goToTab')
              }
              onReset={() => setBinding('goToTab', DEFAULT_KEYMAP.goToTab)}
              onUnset={() => setBinding('goToTab', null)}
              defaultBinding={DEFAULT_KEYMAP.goToTab}
              display={formatBinding(
                bindings.goToTab,
                bindings.goToTab ? '1 - 99' : undefined,
              )}
              hasConflict={duplicates.has('goToTab')}
            />
            <div className="pt-2 border-t border-zinc-700">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Shells
              </span>
            </div>
            <ShortcutRow
              label="New Shell"
              binding={bindings.newShell}
              isRecording={recording === 'newShell'}
              recordingKeys={recording === 'newShell' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'newShell' ? null : 'newShell')
              }
              onReset={() => setBinding('newShell', DEFAULT_KEYMAP.newShell)}
              onUnset={() => setBinding('newShell', null)}
              hasConflict={duplicates.has('newShell')}
              defaultBinding={DEFAULT_KEYMAP.newShell}
              display={formatBinding(bindings.newShell)}
            />
            <ShortcutRow
              label="Close Shell"
              binding={bindings.closeShell}
              isRecording={recording === 'closeShell'}
              recordingKeys={recording === 'closeShell' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'closeShell' ? null : 'closeShell')
              }
              onReset={() =>
                setBinding('closeShell', DEFAULT_KEYMAP.closeShell)
              }
              onUnset={() => setBinding('closeShell', null)}
              hasConflict={duplicates.has('closeShell')}
              defaultBinding={DEFAULT_KEYMAP.closeShell}
              display={formatBinding(bindings.closeShell)}
            />
            <ShortcutRow
              label="Go to shell"
              binding={bindings.goToShell}
              isRecording={recording === 'goToShell'}
              recordingKeys={recording === 'goToShell' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'goToShell' ? null : 'goToShell')
              }
              onReset={() => setBinding('goToShell', DEFAULT_KEYMAP.goToShell)}
              onUnset={() => setBinding('goToShell', null)}
              defaultBinding={DEFAULT_KEYMAP.goToShell}
              display={formatBinding(
                bindings.goToShell,
                bindings.goToShell ? '1 - 9' : undefined,
              )}
              hasConflict={duplicates.has('goToShell')}
            />
            <ShortcutRow
              label="Previous shell"
              binding={bindings.prevShell}
              isRecording={recording === 'prevShell'}
              recordingKeys={recording === 'prevShell' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'prevShell' ? null : 'prevShell')
              }
              onReset={() => setBinding('prevShell', DEFAULT_KEYMAP.prevShell)}
              onUnset={() => setBinding('prevShell', null)}
              defaultBinding={DEFAULT_KEYMAP.prevShell}
              display={formatBinding(bindings.prevShell)}
              hasConflict={duplicates.has('prevShell')}
            />
            <ShortcutRow
              label="Next shell"
              binding={bindings.nextShell}
              isRecording={recording === 'nextShell'}
              recordingKeys={recording === 'nextShell' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'nextShell' ? null : 'nextShell')
              }
              onReset={() => setBinding('nextShell', DEFAULT_KEYMAP.nextShell)}
              onUnset={() => setBinding('nextShell', null)}
              defaultBinding={DEFAULT_KEYMAP.nextShell}
              display={formatBinding(bindings.nextShell)}
              hasConflict={duplicates.has('nextShell')}
            />

            <div className="pt-2 border-t border-zinc-700">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Other
              </span>
            </div>
            <ShortcutRow
              label="Toggle PiP Window"
              binding={bindings.togglePip}
              isRecording={recording === 'togglePip'}
              recordingKeys={recording === 'togglePip' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'togglePip' ? null : 'togglePip')
              }
              onReset={() => setBinding('togglePip', DEFAULT_KEYMAP.togglePip)}
              onUnset={() => setBinding('togglePip', null)}
              defaultBinding={DEFAULT_KEYMAP.togglePip}
              display={formatBinding(bindings.togglePip)}
              hasConflict={duplicates.has('togglePip')}
            />
            <ShortcutRow
              label="Project Actions"
              binding={bindings.itemActions}
              isRecording={recording === 'itemActions'}
              recordingKeys={recording === 'itemActions' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'itemActions' ? null : 'itemActions')
              }
              onReset={() =>
                setBinding('itemActions', DEFAULT_KEYMAP.itemActions)
              }
              onUnset={() => setBinding('itemActions', null)}
              defaultBinding={DEFAULT_KEYMAP.itemActions}
              display={formatBinding(bindings.itemActions)}
              hasConflict={duplicates.has('itemActions')}
            />
            <ShortcutRow
              label="Collapse All"
              binding={bindings.collapseAll}
              isRecording={recording === 'collapseAll'}
              recordingKeys={recording === 'collapseAll' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'collapseAll' ? null : 'collapseAll')
              }
              onReset={() =>
                setBinding('collapseAll', DEFAULT_KEYMAP.collapseAll)
              }
              onUnset={() => setBinding('collapseAll', null)}
              defaultBinding={DEFAULT_KEYMAP.collapseAll}
              display={formatBinding(bindings.collapseAll)}
              hasConflict={duplicates.has('collapseAll')}
            />
            <ShortcutRow
              label="Settings"
              binding={bindings.settings}
              isRecording={recording === 'settings'}
              recordingKeys={recording === 'settings' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'settings' ? null : 'settings')
              }
              onReset={() => setBinding('settings', DEFAULT_KEYMAP.settings)}
              onUnset={() => setBinding('settings', null)}
              hasConflict={duplicates.has('settings')}
              defaultBinding={DEFAULT_KEYMAP.settings}
              display={formatBinding(bindings.settings)}
            />
            <ShortcutRow
              label="Shell Templates"
              binding={bindings.shellTemplates}
              isRecording={recording === 'shellTemplates'}
              recordingKeys={
                recording === 'shellTemplates' ? recordingKeys : []
              }
              onRecord={() =>
                setRecording(
                  recording === 'shellTemplates' ? null : 'shellTemplates',
                )
              }
              onReset={() =>
                setBinding('shellTemplates', DEFAULT_KEYMAP.shellTemplates)
              }
              onUnset={() => setBinding('shellTemplates', null)}
              hasConflict={duplicates.has('shellTemplates')}
              defaultBinding={DEFAULT_KEYMAP.shellTemplates}
              display={formatBinding(bindings.shellTemplates)}
            />
            <ShortcutRow
              label="Custom Commands"
              binding={bindings.customCommands}
              isRecording={recording === 'customCommands'}
              recordingKeys={
                recording === 'customCommands' ? recordingKeys : []
              }
              onRecord={() =>
                setRecording(
                  recording === 'customCommands' ? null : 'customCommands',
                )
              }
              onReset={() =>
                setBinding('customCommands', DEFAULT_KEYMAP.customCommands)
              }
              onUnset={() => setBinding('customCommands', null)}
              hasConflict={duplicates.has('customCommands')}
              defaultBinding={DEFAULT_KEYMAP.customCommands}
              display={formatBinding(bindings.customCommands)}
            />

            <div className="pt-2 border-t border-zinc-700">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Commit
              </span>
            </div>
            <ShortcutRow
              label="Toggle Amend"
              binding={bindings.commitAmend}
              isRecording={recording === 'commitAmend'}
              recordingKeys={recording === 'commitAmend' ? recordingKeys : []}
              onRecord={() =>
                setRecording(recording === 'commitAmend' ? null : 'commitAmend')
              }
              onReset={() =>
                setBinding('commitAmend', DEFAULT_KEYMAP.commitAmend)
              }
              onUnset={() => setBinding('commitAmend', null)}
              hasConflict={duplicates.has('commitAmend')}
              defaultBinding={DEFAULT_KEYMAP.commitAmend}
              display={formatBinding(bindings.commitAmend)}
            />
            <ShortcutRow
              label="Toggle No Verify"
              binding={bindings.commitNoVerify}
              isRecording={recording === 'commitNoVerify'}
              recordingKeys={
                recording === 'commitNoVerify' ? recordingKeys : []
              }
              onRecord={() =>
                setRecording(
                  recording === 'commitNoVerify' ? null : 'commitNoVerify',
                )
              }
              onReset={() =>
                setBinding('commitNoVerify', DEFAULT_KEYMAP.commitNoVerify)
              }
              onUnset={() => setBinding('commitNoVerify', null)}
              hasConflict={duplicates.has('commitNoVerify')}
              defaultBinding={DEFAULT_KEYMAP.commitNoVerify}
              display={formatBinding(bindings.commitNoVerify)}
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

      <ConfirmModal
        open={showConfirmClose}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmLabel="Discard"
        variant="danger"
        onConfirm={handleDiscardChanges}
        onCancel={() => setShowConfirmClose(false)}
      />
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
            'h-7 px-2.5 cursor-pointer text-xs font-mono rounded-md border transition-colors inline-flex items-center',
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
            className="h-7 w-7 cursor-pointer inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md border border-border bg-zinc-800 hover:bg-zinc-700/70 transition-colors"
            title="Reset to default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {!isDisabled && (
          <button
            type="button"
            onClick={onUnset}
            className="h-7 w-7 cursor-pointer inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md border border-border bg-zinc-800 hover:bg-zinc-700/70 transition-colors"
            title="Disable shortcut"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
