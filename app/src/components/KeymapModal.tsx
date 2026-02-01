import { ArrowBigUp, ChevronUp, Command, Option, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '../hooks/useSettings'
import { DEFAULT_KEYMAP, type ShortcutBinding } from '../types'
import { cn } from '@/lib/utils'

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

const ICON_CLASS = 'inline-block w-3 h-3 align-[-2px]'

function formatBinding(binding: ShortcutBinding, suffix?: string): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      {binding.ctrlKey && <ChevronUp className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.altKey && <Option className={cn(ICON_CLASS, 'stroke-3')} />}
      {binding.shiftKey && <ArrowBigUp className={cn(ICON_CLASS, 'stroke-3')} />}
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
  const isDigit = palette.key >= '1' && palette.key <= '9'
  if (!isDigit) return false
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
  const [recording, setRecording] = useState<'palette' | 'goToTab' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings?.keymap) {
      setPalette(settings.keymap.palette)
      setGoToTab(settings.keymap.goToTab)
    }
  }, [settings?.keymap])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(null)
        return
      }

      if (MODIFIER_KEYS.has(e.key) && DEFAULT_KEYMAP[recording].key) return

      const binding: ShortcutBinding = {}
      if (e.metaKey) binding.metaKey = true
      if (e.ctrlKey) binding.ctrlKey = true
      if (e.altKey) binding.altKey = true
      if (e.shiftKey) binding.shiftKey = true

      if (recording === 'palette') {
        binding.key = e.key.toLowerCase()
        setPalette(binding)
      } else {
        setGoToTab(binding)
      }

      setRecording(null)
    },
    [recording],
  )

  useEffect(() => {
    if (!recording) return
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, handleKeyDown])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings({ keymap: { palette, goToTab } })
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
            onRecord={() =>
              setRecording(recording === 'palette' ? null : 'palette')
            }
            display={formatBinding(palette)}
            hasConflict={hasConflict}
          />
          <ShortcutRow
            label="Go to Tab"
            binding={goToTab}
            isRecording={recording === 'goToTab'}
            onRecord={() =>
              setRecording(recording === 'goToTab' ? null : 'goToTab')
            }
            display={formatBinding(goToTab, '1-9')}
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
  onRecord,
  binding,
  display,
  hasConflict,
}: {
  label: string
  binding: ShortcutBinding
  isRecording: boolean
  onRecord: () => void
  display: ReactNode
  hasConflict?: boolean
}) {

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium flex flex-col gap-0">
        {label}
        {!binding.key && <span className="text-xs font-normal text-muted-foreground">Modifier only</span>}
      </span>
      <button
        type="button"
        onClick={onRecord}
        className={`px-3 py-1.5 cursor-pointer text-sm font-mono rounded-md border transition-colors ${isRecording
          ? 'border-primary bg-primary/10 text-primary animate-pulse'
          : hasConflict
            ? 'border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
            : 'border-border bg-zinc-800 hover:bg-zinc-700/70'
          }`}
      >
        {isRecording ? 'Press shortcut...' : display}
      </button>
    </div>
  )
}
