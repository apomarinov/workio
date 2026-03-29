import {
  DEFAULT_KEYMAP,
  type Keymap,
  type ShortcutBinding,
} from '@domains/settings/schema'
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  ChevronUp,
  Command,
  CornerDownLeft,
  Delete,
  Keyboard,
  MouseLeft,
  Option,
  RotateCcw,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '@/hooks/useSettings'
import { toastError } from '@/lib/toastError'
import { cn } from '@/lib/utils'
import { useSettingsView } from './SettingsViewContext'

// --- Display helpers ---

const CODE_TO_DISPLAY: Record<string, string> = {
  bracketleft: '[',
  bracketright: ']',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
}

function mapEventCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return code.toLowerCase()
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])
const MOD_MAP: Record<string, 'meta' | 'ctrl' | 'alt' | 'shift'> = {
  Meta: 'meta',
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
}

function codeToPreviewKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) return code
  const normalized = code.toLowerCase()
  return CODE_TO_DISPLAY[normalized] ?? code
}

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
  if (key === 'Enter') return <CornerDownLeft className={cls} />
  return <span>{key.toUpperCase()}</span>
}

function formatKeyDisplay(key: string): ReactNode {
  const cls = cn(ICON_CLASS, 'stroke-3')
  if (key === 'arrowup') return <ArrowUp className={cls} />
  if (key === 'arrowdown') return <ArrowDown className={cls} />
  if (key === 'arrowleft') return <ArrowLeft className={cls} />
  if (key === 'arrowright') return <ArrowRight className={cls} />
  if (key === 'enter') return <CornerDownLeft className={cls} />
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

type ShortcutName = keyof Keymap

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
      if (!a || !b || !a.key || !b.key) continue
      if (ALLOWED_DUPLICATE_PAIRS.has(`${keys[i]}:${keys[j]}`)) continue
      if (bindingsEqual(a, b)) {
        duplicates.add(keys[i])
        duplicates.add(keys[j])
      }
    }
  }
  return duplicates
}

// --- Components ---

export function KeymapView() {
  const { closeKeymap, search } = useSettingsView()
  const { settings, updateSettings } = useSettings()

  const [bindings, setBindings] = useState<
    Record<ShortcutName, ShortcutBinding | null>
  >({ ...DEFAULT_KEYMAP })
  const [recording, setRecording] = useState<ShortcutName | null>(null)
  const [recordingKeys, setRecordingKeys] = useState<string[]>([])

  // Disable global shortcuts while keymap view is active
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('shortcuts-disabled', { detail: true }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('shortcuts-disabled', { detail: false }),
      )
    }
  }, [])

  // Sync from settings
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

  // Auto-save helper
  const autoSave = (next: Record<ShortcutName, ShortcutBinding | null>) => {
    setBindings(next)
    updateSettings({ keymap: next as Keymap })
      .then(() => toast.success('Shortcut saved'))
      .catch((err) => toastError(err, 'Failed to save shortcut'))
  }

  const setBinding = (name: ShortcutName, value: ShortcutBinding | null) => {
    autoSave({ ...bindings, [name]: value })
  }

  const handleReset = () => {
    setRecording(null)
    autoSave({ ...DEFAULT_KEYMAP })
  }

  // Recording effect
  useEffect(() => {
    if (!recording) return
    setRecordingKeys([])

    const heldMods = new Set<string>()
    let modifierBuffer = {
      meta: false,
      ctrl: false,
      alt: false,
      shift: false,
    }
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
      const next = { ...bindings, [recording]: binding }
      setBindings(next)
      setRecording(null)
      updateSettings({ keymap: next as Keymap })
        .then(() => toast.success('Shortcut saved'))
        .catch((err) => toastError(err, 'Failed to save shortcut'))
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

      if (!active) {
        setRecordingKeys([codeToPreviewKey(e.code)])
        if (!DEFAULT_KEYMAP[recording]?.key) {
          autoSave({ ...bindings, [recording]: {} })
        } else {
          autoSave({ ...bindings, [recording]: { key: mapEventCode(e.code) } })
        }
        setRecording(null)
        return
      }

      if (!DEFAULT_KEYMAP[recording]?.key) {
        finalize()
        return
      }

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
      if (active) setRecording(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording]) // eslint-disable-line react-hooks/exhaustive-deps

  const duplicates = useMemo(() => findDuplicates(bindings), [bindings])
  const q = search.trim().toLowerCase()

  const shortcutItem = (
    name: ShortcutName,
    label: string,
    opts?: { suffix?: string; description?: string },
  ): { label: string; node: ReactNode } => ({
    label,
    node: (
      <ShortcutRow
        key={name}
        label={label}
        description={opts?.description}
        binding={bindings[name]}
        isRecording={recording === name}
        recordingKeys={recording === name ? recordingKeys : []}
        onRecord={() => setRecording(recording === name ? null : name)}
        onReset={() => setBinding(name, DEFAULT_KEYMAP[name])}
        onUnset={() => setBinding(name, null)}
        defaultBinding={DEFAULT_KEYMAP[name]}
        display={formatBinding(bindings[name], opts?.suffix)}
        hasConflict={duplicates.has(name)}
      />
    ),
  })

  const infoItem = (
    label: string,
    display: ReactNode,
  ): { label: string; node: ReactNode } => ({
    label,
    node: <InfoShortcutRow label={label} display={display} />,
  })

  return (
    <div className="absolute inset-0 flex flex-col bg-[#1a1a1a] z-10">
      <div className="flex items-center gap-2 p-2 border-b border-zinc-700/50">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={closeKeymap}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Keyboard className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium flex-1">Keyboard Shortcuts</span>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Reset All
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="w-full space-y-1.5">
          <FilteredSection
            heading="General"
            search={q}
            items={[
              shortcutItem('palette', 'Command Palette'),
              shortcutItem('settings', 'Settings'),
              shortcutItem('collapseAll', 'Collapse All'),
              shortcutItem('customCommands', 'Custom Commands'),
              shortcutItem('toggleSidebar', 'Toggle Sidebar'),
              shortcutItem('togglePip', 'Toggle PiP Window'),
            ]}
          />

          <FilteredSection
            heading="Projects"
            search={q}
            items={[
              shortcutItem('goToTab', 'Go to project', {
                suffix: bindings.goToTab ? '1 - 9' : undefined,
              }),
              shortcutItem('itemActions', 'Actions'),
            ]}
          />

          <FilteredSection
            heading="Shells"
            search={q}
            items={[
              shortcutItem('newShell', 'New Shell'),
              shortcutItem('closeShell', 'Close Shell'),
              shortcutItem('goToShell', 'Go to shell', {
                suffix: bindings.goToShell ? '1 - 9' : undefined,
              }),
              shortcutItem('prevShell', 'Previous shell'),
              shortcutItem('nextShell', 'Next shell'),
              shortcutItem('shellTemplates', 'Shell Templates'),
              infoItem(
                'Focus active shell',
                <ArrowRightToLine className={cn(ICON_CLASS, 'stroke-3')} />,
              ),
              infoItem(
                'Open file in IDE',
                <MouseLeft className={ICON_CLASS} />,
              ),
              infoItem(
                'Open file in Finder',
                <span className="inline-flex items-center gap-1">
                  <Command className={cn(ICON_CLASS, 'stroke-3')} />
                  <MouseLeft className={ICON_CLASS} />
                </span>,
              ),
              infoItem(
                'Copy filepath/URL',
                <span className="inline-flex items-center gap-1">
                  <Option className={cn(ICON_CLASS, 'stroke-3')} />
                  <MouseLeft className={ICON_CLASS} />
                </span>,
              ),
              infoItem(
                'Jump line',
                <span className="inline-flex items-center gap-1">
                  <Command className={cn(ICON_CLASS, 'stroke-3')} />
                  <ArrowLeft className={cn(ICON_CLASS, 'stroke-3')} />
                  <span>/</span>
                  <ArrowRight className={cn(ICON_CLASS, 'stroke-3')} />
                </span>,
              ),
              infoItem(
                'Jump word',
                <span className="inline-flex items-center gap-1">
                  <Option className={cn(ICON_CLASS, 'stroke-3')} />
                  <ArrowLeft className={cn(ICON_CLASS, 'stroke-3')} />
                  <span>/</span>
                  <ArrowRight className={cn(ICON_CLASS, 'stroke-3')} />
                </span>,
              ),
              infoItem(
                'Delete word',
                <span className="inline-flex items-center gap-1">
                  <Option className={cn(ICON_CLASS, 'stroke-3')} />
                  <Delete className={cn(ICON_CLASS, 'stroke-3')} />
                </span>,
              ),
              infoItem(
                'Delete line',
                <span className="inline-flex items-center gap-1">
                  <Command className={cn(ICON_CLASS, 'stroke-3')} />
                  <Delete className={cn(ICON_CLASS, 'stroke-3')} />
                </span>,
              ),
            ]}
          />

          <FilteredSection
            heading="Git"
            search={q}
            items={[
              shortcutItem('branches', 'Branches'),
              shortcutItem('pullBranch', 'Pull Current Branch', {
                description: '(rebase)',
              }),
              shortcutItem('commit', 'Commit', {
                description: '(dirty → commit, clean → log)',
              }),
              shortcutItem('commitAmend', 'Toggle Amend'),
              shortcutItem('commitNoVerify', 'Toggle No Verify'),
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function FilteredSection({
  heading,
  search,
  items,
}: {
  heading: string
  search: string
  items: { label: string; node: ReactNode }[]
}) {
  const filtered = search
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(search) ||
          heading.toLowerCase().includes(search),
      )
    : items
  if (filtered.length === 0) return null
  return (
    <>
      <SectionHeader>{heading}</SectionHeader>
      <SectionRows>
        {filtered.map((item) => (
          <div key={item.label}>{item.node}</div>
        ))}
      </SectionRows>
    </>
  )
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="pb-1 border-b border-zinc-700">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {children}
      </span>
    </div>
  )
}

function SectionRows({ children }: { children: ReactNode }) {
  return (
    <div className="[&>div:nth-child(odd)]:bg-zinc-800/30 [&>div]:hover:!bg-zinc-700/50 [&>div]:transition-colors [&>div:first-child]:rounded-t-md [&>div:last-child]:rounded-b-md">
      {children}
    </div>
  )
}

function InfoShortcutRow({
  label,
  display,
}: {
  label: string
  display: ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="h-7 px-2.5 text-xs font-mono rounded-md border border-border bg-zinc-800/50 text-muted-foreground inline-flex items-center">
        {display}
      </span>
    </div>
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
  description,
}: {
  label: string
  description?: string
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
    <div className="flex items-center justify-between px-2 py-1.5">
      <div className="flex gap-1 items-center">
        <span className="text-sm font-medium flex flex-col gap-0">{label}</span>
        {binding && !binding.key && (
          <span className="text-xs font-normal text-muted-foreground">
            Modifier only
          </span>
        )}
        {description && (
          <span className="text-xs font-normal text-muted-foreground">
            {description}
          </span>
        )}
      </div>
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
