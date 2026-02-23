import { CornerDownLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  mode: 'hidden' | 'input' | 'actions'
  inputRef?: React.RefObject<HTMLInputElement | null>
}

const DEFAULT_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false }

function sendToTerminal(terminalId: number, text: string) {
  window.dispatchEvent(
    new CustomEvent('terminal-paste', { detail: { terminalId, text } }),
  )
}

export function MobileKeyboard({
  terminalId,
  mode,
  inputRef,
}: MobileKeyboardProps) {
  const { settings, updateSettings } = useSettings()
  const [inputValue, setInputValue] = useState('')
  const [activeModifiers, setActiveModifiers] =
    useState<Modifiers>(DEFAULT_MODIFIERS)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const rows: MobileKeyboardRow[] =
    settings?.mobile_keyboard_rows ?? DEFAULT_KEYBOARD_ROWS
  const allActions = buildActionsMap(settings?.custom_terminal_actions)

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
        .catch(() => {})
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
          <div className="flex gap-1 px-1.5 py-1 overflow-x-auto">
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
                      'px-3 py-1.5 rounded-md text-xs font-medium flex-shrink-0 select-none',
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
          className={cn(
            'flex items-center gap-1.5',
            isInput && 'px-1.5 pb-1.5',
          )}
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Type here..."
            className="flex-1 min-w-0 px-3 py-1 rounded-lg bg-zinc-800 text-white text-base placeholder-zinc-500 outline-none border border-zinc-700/50 focus:border-blue-500/50"
          />
          {isInput && (
            <button
              type="button"
              onClick={handleSubmit}
              className="flex-shrink-0 w-14 h-9 flex items-center justify-center rounded-lg bg-blue-600 text-white active:bg-blue-500"
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
        customActions={settings?.custom_terminal_actions ?? []}
        onSave={handleSaveCustomize}
        onCustomActionCreated={handleCustomActionCreated}
        onClose={() => setCustomizeOpen(false)}
      />
    </>
  )
}
