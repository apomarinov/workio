import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTerminalContext } from '@/context/TerminalContext'
import type { CustomTerminalAction } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

interface MobileKeyboardCustomActionProps {
  open: boolean
  initialAction?: CustomTerminalAction
  onSave: (action: CustomTerminalAction) => void
  onClose: () => void
}

export function MobileKeyboardCustomAction({
  open,
  initialAction,
  onSave,
  onClose,
}: MobileKeyboardCustomActionProps) {
  const { terminals } = useTerminalContext()
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [repo, setRepo] = useState('')

  // Build unique repo list from terminals that have a git repo
  const repos = terminals
    .filter((t) => t.git_repo?.repo && t.git_repo.status === 'done')
    .map((t) => t.git_repo!.repo)
    .filter((r, i, arr) => arr.indexOf(r) === i)

  useEffect(() => {
    if (open) {
      setLabel(initialAction?.label ?? '')
      setCommand(initialAction?.command ?? '')
      setRepo(initialAction?.repo ?? '')
    }
  }, [open])

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose()
    }
  }

  const handleConfirm = () => {
    const trimmedLabel = label.trim()
    const trimmedCommand = command.trim()
    if (!trimmedLabel || !trimmedCommand) return
    onSave({
      id:
        initialAction?.id ??
        `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: trimmedLabel,
      command: trimmedCommand,
      ...(repo ? { repo } : {}),
    })
    setLabel('')
    setCommand('')
    setRepo('')
  }

  const canSave = label.trim().length > 0 && command.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md p-0 top-[10%] translate-y-0">
        <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between px-4 pt-4 pb-2 space-y-0">
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
          <DialogTitle className="text-base font-semibold">
            {initialAction ? 'Edit Action' : 'New Action'}
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
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-base placeholder-zinc-500 outline-none border border-zinc-700/50 focus:border-blue-500/50"
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
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-base placeholder-zinc-500 outline-none border border-zinc-700/50 focus:border-blue-500/50"
            />
          </div>
          {repos.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground/70 mb-1 block">
                Git Repo (optional)
              </label>
              <select
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-base outline-none border border-zinc-700/50 focus:border-blue-500/50"
              >
                <option value="">Any terminal</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-muted-foreground/50">
            The command will be sent to the terminal with Enter appended.
            {repos.length > 0 &&
              ' Optionally pick a repo to always target that terminal.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
