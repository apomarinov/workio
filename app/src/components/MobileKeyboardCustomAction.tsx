import { Check, X } from 'lucide-react'
import { useState } from 'react'
import type { CustomTerminalAction } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

interface MobileKeyboardCustomActionProps {
  open: boolean
  onSave: (action: CustomTerminalAction) => void
  onClose: () => void
}

export function MobileKeyboardCustomAction({
  open,
  onSave,
  onClose,
}: MobileKeyboardCustomActionProps) {
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setLabel('')
      setCommand('')
    } else {
      onClose()
    }
  }

  const handleConfirm = () => {
    const trimmedLabel = label.trim()
    const trimmedCommand = command.trim()
    if (!trimmedLabel || !trimmedCommand) return
    onSave({
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: trimmedLabel,
      command: trimmedCommand,
    })
    setLabel('')
    setCommand('')
  }

  const canSave = label.trim().length > 0 && command.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between px-4 pt-4 pb-2 space-y-0">
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
          <DialogTitle className="text-base font-semibold">
            New Action
          </DialogTitle>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            className={
              canSave
                ? 'p-1 text-green-400 hover:text-foreground'
                : 'p-1 text-muted-foreground opacity-40'
            }
          >
            <Check className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground/70 mb-1 block">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. deploy"
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-sm placeholder-zinc-500 outline-none border border-zinc-700/50 focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground/70 mb-1 block">
              Command
            </label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. npm run deploy"
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-sm placeholder-zinc-500 outline-none border border-zinc-700/50 focus:border-blue-500/50"
            />
          </div>
          <p className="text-xs text-muted-foreground/50">
            The command will be sent to the terminal with Enter appended.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
