import { ArrowUpFromLine, CornerDownLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '@/hooks/useSettings'
import {
  applyModifier,
  applyModifierToAction,
  buildActionsMap,
  DEFAULT_KEYBOARD_ROWS,
  type Modifiers,
} from '@/lib/terminalActions'
import { cn } from '@/lib/utils'
import type { CustomTerminalAction, MobileKeyboardRow } from '../types'
import { MobileKeyboardActions } from './MobileKeyboardActions'
import { MobileKeyboardCustomize } from './MobileKeyboardCustomize'

interface MobileKeyboardProps {
  terminalId: number
  currentRepo: string | undefined
  mode: 'hidden' | 'input' | 'actions'
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

const DEFAULT_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false }

function sendToTerminal(terminalId: number, text: string) {
  window.dispatchEvent(
    new CustomEvent('terminal-paste', { detail: { terminalId, text } }),
  )
}

export function MobileKeyboard({
  terminalId,
  currentRepo,
  mode,
  inputRef,
}: MobileKeyboardProps) {
  const { settings, updateSettings } = useSettings()
  const [inputValue, setInputValue] = useState('')
  const [directInput, setDirectInput] = useState(false)
  const [activeModifiers, setActiveModifiers] =
    useState<Modifiers>(DEFAULT_MODIFIERS)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const composingRef = useRef(false)

  const rows: MobileKeyboardRow[] =
    settings?.mobile_keyboard_rows ?? DEFAULT_KEYBOARD_ROWS
  const allCustomActions = settings?.custom_terminal_actions ?? []
  const filteredCustomActions = allCustomActions.filter(
    (ca) => !ca.repo || ca.repo === currentRepo,
  )
  const allActions = buildActionsMap(filteredCustomActions)

  const resetModifiers = () => setActiveModifiers(DEFAULT_MODIFIERS)

  const handleSubmit = () => {
    if (!inputValue) {
      sendToTerminal(terminalId, '\r')
      return
    }
    let text = ''
    for (const char of inputValue) {
      text += applyModifier(char, activeModifiers)
    }
    sendToTerminal(terminalId, text)
    // Send Enter separately so programs like Claude Code don't treat it
    // as part of a paste blob (which would insert a newline instead of submitting)
    setTimeout(() => sendToTerminal(terminalId, '\r'), 10)
    setInputValue('')
    resetModifiers()
  }

  const handleActionTap = (actionId: string) => {
    const action = allActions[actionId]
    if (!action) return

    if (action.isModifier) {
      setActiveModifiers((prev) => ({
        ...prev,
        [actionId]: !prev[actionId as keyof Modifiers],
      }))
      return
    }

    if (actionId === 'paste') {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) sendToTerminal(terminalId, text)
        })
        .catch(() => toast.error('Failed to read clipboard'))
      resetModifiers()
      return
    }

    if (action.category === 'custom') {
      sendToTerminal(terminalId, `${action.sequence}\r`)
      resetModifiers()
      return
    }

    const sequence = applyModifierToAction(action.sequence, activeModifiers)
    sendToTerminal(terminalId, sequence)
    resetModifiers()
  }

  const handleSaveCustomize = (newRows: MobileKeyboardRow[]) => {
    updateSettings({ mobile_keyboard_rows: newRows })
    setCustomizeOpen(false)
  }

  const handleCustomActionCreated = (action: CustomTerminalAction) => {
    const existing = settings?.custom_terminal_actions ?? []
    updateSettings({ custom_terminal_actions: [...existing, action] })
  }

  const handleCustomActionUpdated = (action: CustomTerminalAction) => {
    const existing = settings?.custom_terminal_actions ?? []
    updateSettings({
      custom_terminal_actions: existing.map((a) =>
        a.id === action.id ? action : a,
      ),
    })
  }

  const handleCustomActionDeleted = (actionId: string) => {
    const existing = settings?.custom_terminal_actions ?? []
    updateSettings({
      custom_terminal_actions: existing.filter((a) => a.id !== actionId),
    })
  }

  useEffect(() => {
    const handler = () => setCustomizeOpen(true)
    window.addEventListener('mobile-keyboard-customize', handler)
    return () =>
      window.removeEventListener('mobile-keyboard-customize', handler)
  }, [])

  const isInput = mode === 'input'

  return (
    <>
      {/*
        The proxy input is ALWAYS in the DOM (even when hidden) so that iOS
        can receive a synchronous focus() call during a user gesture,
        which is the only way to open the native keyboard programmatically.
        When not in input mode it's collapsed to 0×0 and invisible.
      */}
      <div
        className={cn(
          'relative',
          isInput
            ? 'bg-zinc-900 border-t border-zinc-700/50'
            : 'h-0 overflow-hidden opacity-0 pointer-events-none',
        )}
      >
        {isInput && rows.length > 0 && (
          <div className="flex gap-1.5 p-1.5 overflow-x-auto">
            {rows.flatMap((row) =>
              row.actions.map((actionId) => {
                const action = allActions[actionId]
                if (!action) return null
                const isModifier = action.isModifier === true
                const isActive =
                  isModifier && activeModifiers[actionId as keyof Modifiers]
                return (
                  <button
                    key={`quick-${row.id}-${actionId}`}
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerUp={() => handleActionTap(actionId)}
                    className={cn(
                      'px-2 py-1.5 min-w-10 max-w-[220px] truncate rounded-md text-base font-medium flex-shrink-0 select-none',
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-700/80 text-zinc-300 active:bg-zinc-600',
                    )}
                  >
                    {action.label}
                  </button>
                )
              }),
            )}
          </div>
        )}
        <div
          className={cn('flex items-end gap-1.5', isInput && 'px-1.5 pb-1.5')}
        >
          <textarea
            ref={inputRef}
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            rows={1}
            value={inputValue}
            onChange={(e) => {
              if (directInput) {
                if (composingRef.current) return
                const val = e.target.value
                if (val) {
                  let text = ''
                  for (const char of val) {
                    text += applyModifier(char, activeModifiers)
                  }
                  sendToTerminal(terminalId, text)
                }
                setInputValue('')
                return
              }
              setInputValue(e.target.value)
              // Auto-resize: reset then clamp to 5 lines
              const el = e.target
              el.style.height = 'auto'
              const lineHeight =
                parseInt(getComputedStyle(el).lineHeight, 10) || 20
              el.style.height = `${Math.min(el.scrollHeight, lineHeight * 5)}px`
            }}
            onKeyDown={(e) => {
              if (directInput) {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  sendToTerminal(terminalId, '\r')
                  return
                }
                if (e.key === 'Backspace') {
                  e.preventDefault()
                  sendToTerminal(terminalId, '\x7f')
                  return
                }
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false
              if (directInput) {
                const val = (e.target as HTMLTextAreaElement).value
                if (val) {
                  let text = ''
                  for (const char of val) {
                    text += applyModifier(char, activeModifiers)
                  }
                  sendToTerminal(terminalId, text)
                }
                setInputValue('')
              }
            }}
            onPaste={(e) => {
              if (directInput) {
                e.preventDefault()
                const text = e.clipboardData.getData('text')
                if (text) sendToTerminal(terminalId, text)
              }
            }}
            placeholder={directInput ? 'Direct input...' : 'Type here...'}
            className={cn(
              'flex-1 min-w-0 px-3 !h-10 py-2 rounded-lg bg-zinc-800 text-white text-base placeholder-zinc-500 outline-none border resize-none leading-5 overflow-y-auto',
              directInput
                ? 'border-blue-500/70 focus:border-blue-500'
                : 'border-zinc-700/50 focus:border-blue-500/50',
            )}
          />
          {isInput && (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onPointerUp={() => {
                setDirectInput((prev) => !prev)
                if (!directInput) {
                  setInputValue('')
                }
                inputRef?.current?.focus()
              }}
              className={cn(
                'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg',
                directInput
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700/80 text-zinc-300 active:bg-zinc-600',
              )}
            >
              <ArrowUpFromLine className="w-4 h-4" />
            </button>
          )}
          {isInput && !directInput && (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onPointerUp={handleSubmit}
              className="flex-shrink-0 w-14 h-10 flex items-center justify-center rounded-lg bg-blue-600 text-white active:bg-blue-500"
            >
              <CornerDownLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {mode === 'actions' && (
        <div className="bg-zinc-900 border-t border-zinc-700/50">
          <MobileKeyboardActions
            rows={rows}
            activeModifiers={activeModifiers}
            allActions={allActions}
            onActionTap={handleActionTap}
          />
        </div>
      )}

      <MobileKeyboardCustomize
        open={customizeOpen}
        rows={rows}
        customActions={allCustomActions}
        onSave={handleSaveCustomize}
        onCustomActionCreated={handleCustomActionCreated}
        onCustomActionUpdated={handleCustomActionUpdated}
        onCustomActionDeleted={handleCustomActionDeleted}
        onClose={() => setCustomizeOpen(false)}
      />
    </>
  )
}
