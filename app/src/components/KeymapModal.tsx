import { ArrowBigUp, ChevronUp, Command, Option, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
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
  return <span>{key.toUpperCase()}</span>
}

function formatBinding(binding: ShortcutBinding, suffix?: string): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      {binding.ctrlKey && <ChevronUp className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.altKey && <Option className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.shiftKey && (
        <ArrowBigUp className={cn(ICON_CLASS, 'stroke-3')} />
      )}
      {binding.metaKey && <Command className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.key && <span>{binding.key.toUpperCase()}</span>}
      {suffix && <span>{suffix}</span>}
    </span>
  )
}

function bindingsConflict(
  palette: ShortcutBinding,
  goToTab: ShortcutBinding,
): boolean {
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

interface KeymapModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeymapModal({ open, onOpenChange }: KeymapModalProps) {
  const { settings, updateSettings } = useSettings()

  const [palette, setPalette] = useState<ShortcutBinding>(
    DEFAULT_KEYMAP.palette,
  )
  const [goToTab, setGoToTab] = useState<ShortcutBinding>(
    DEFAULT_KEYMAP.goToTab,
  )
  const [goToLastTab, setGoToLastTab] = useState<ShortcutBinding>(
    DEFAULT_KEYMAP.goToLastTab,
  )
  const [togglePip, setTogglePip] = useState<ShortcutBinding>(
    DEFAULT_KEYMAP.togglePip,
  )
  const [recording, setRecording] = useState<
    'palette' | 'goToTab' | 'goToLastTab' | 'togglePip' | null
  >(null)
  const [recordingKeys, setRecordingKeys] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings?.keymap) {
      setPalette(settings.keymap.palette)
      setGoToTab(settings.keymap.goToTab)
      if (settings.keymap.goToLastTab) {
        setGoToLastTab(settings.keymap.goToLastTab)
      }
      if (settings.keymap.togglePip) {
        setTogglePip(settings.keymap.togglePip)
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
        }
        setRecording(null)
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
        keymap: { palette, goToTab, goToLastTab, togglePip },
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
    setRecording(null)
  }

  const hasConflict = bindingsConflict(palette, goToTab)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            display={formatBinding(palette)}
            hasConflict={hasConflict}
          />
          <ShortcutRow
            label="Go to Terminal"
            binding={goToTab}
            isRecording={recording === 'goToTab'}
            recordingKeys={recording === 'goToTab' ? recordingKeys : []}
            onRecord={() =>
              setRecording(recording === 'goToTab' ? null : 'goToTab')
            }
            display={formatBinding(goToTab, '1 - NN')}
          />
          <ShortcutRow
            label="Go to Last Terminal"
            binding={goToLastTab}
            isRecording={recording === 'goToLastTab'}
            recordingKeys={recording === 'goToLastTab' ? recordingKeys : []}
            onRecord={() =>
              setRecording(recording === 'goToLastTab' ? null : 'goToLastTab')
            }
            display={formatBinding(goToLastTab)}
          />
          <ShortcutRow
            label="Toggle PiP Window"
            binding={togglePip}
            isRecording={recording === 'togglePip'}
            recordingKeys={recording === 'togglePip' ? recordingKeys : []}
            onRecord={() =>
              setRecording(recording === 'togglePip' ? null : 'togglePip')
            }
            display={formatBinding(togglePip)}
          />
          {hasConflict && (
            <p className="text-sm text-amber-500">
              Conflict: Command Palette shortcut overlaps with Go to Tab (digit
              key with same modifiers).
            </p>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Reset to Default
          </Button>
          <Button type="button" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutRow({
  label,
  isRecording,
  recordingKeys,
  onRecord,
  binding,
  display,
  hasConflict,
}: {
  label: string
  binding: ShortcutBinding
  isRecording: boolean
  recordingKeys: string[]
  onRecord: () => void
  display: ReactNode
  hasConflict?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium flex flex-col gap-0">
        {label}
        {!binding.key && (
          <span className="text-xs font-normal text-muted-foreground">
            Modifier only
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onRecord}
        className={`px-3 py-1.5 cursor-pointer text-sm font-mono rounded-md border transition-colors ${
          isRecording
            ? 'border-primary bg-primary/10 text-primary animate-pulse'
            : hasConflict
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
              : 'border-border bg-zinc-800 hover:bg-zinc-700/70'
        }`}
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
    </div>
  )
}
