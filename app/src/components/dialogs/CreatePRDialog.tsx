import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import {
  type BranchesResponse,
  checkBranchConflicts,
  createPR,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Terminal } from '../../types'
import { BranchDiffPanel } from '../BranchDiffPanel'

interface CreatePRDialogProps {
  open: boolean
  terminal: Terminal
  branches: BranchesResponse
  onClose: () => void
}

export function CreatePRDialog({
  open,
  terminal,
  branches,
  onClose,
}: CreatePRDialogProps) {
  const headBranch = terminal.git_branch!
  const repo = terminal.git_repo!.repo

  // Find a default base branch
  const allBranchNames = [
    ...branches.local.map((b) => b.name),
    ...branches.remote
      .map((b) => b.name.replace(/^origin\//, ''))
      .filter((n) => !branches.local.some((l) => l.name === n)),
  ]
  const defaultBase =
    allBranchNames.find((b) => b === 'main') ??
    allBranchNames.find((b) => b === 'master') ??
    allBranchNames.find((b) => b !== headBranch) ??
    'main'

  const [title, setTitle] = useState(headBranch.replace(/[-_]/g, ' '))
  const [body, setBody] = useState('')
  const [showDescription, setShowDescription] = useState(false)
  const [baseBranch, setBaseBranch] = useState(defaultBase)
  const [draft, setDraft] = useState(false)
  const [conflicts, setConflicts] = useState<boolean | null>(null)
  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [noRemote, setNoRemote] = useState(false)
  const [creating, setCreating] = useState(false)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)

  // Fetch conflicts when base branch changes
  useEffect(() => {
    if (!open) return
    setConflicts(null)
    setNoRemote(false)

    setCheckingConflicts(true)

    checkBranchConflicts(terminal.id, headBranch, baseBranch)
      .then((data) => setConflicts(data.hasConflicts))
      .catch(() => setConflicts(null))
      .finally(() => setCheckingConflicts(false))
  }, [open, baseBranch, headBranch, terminal.id])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle(headBranch.replace(/[-_]/g, ' '))
      setBody('')
      setShowDescription(false)
      setBaseBranch(defaultBase)
      setDraft(false)
      setConflicts(null)
      setNoRemote(false)
      setCreating(false)
    }
  }, [open])

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      const [owner, repoName] = repo.split('/')
      const result = await createPR(
        owner,
        repoName,
        headBranch,
        baseBranch,
        title.trim(),
        body,
        draft,
      )
      toast.success(`Created PR #${result.prNumber}`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create PR')
    } finally {
      setCreating(false)
    }
  }

  // Available base branches (exclude head branch)
  const baseBranchOptions = allBranchNames.filter((b) => b !== headBranch)

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && !creating && onClose()}
    >
      <DialogContent
        className="w-[100vw] max-w-none p-2 pt-[max(0.5rem,env(safe-area-inset-top))] rounded-none sm:w-[95vw] sm:max-w-[1500px] sm:p-4 sm:pt-4 sm:rounded-lg h-[100dvh] max-h-none sm:h-[95vh] sm:max-h-[1500px] flex flex-col overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            <div className="flex justify-start gap-3 max-sm:flex-col">
              <div className="flex justify-start gap-3 ">
                <span className="w-fit">Create Pull Request</span>
                <div className="flex items-center gap-3 mr-auto">
                  {noRemote ? (
                    <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                      <X className="h-3 w-3" />
                      Branch not pushed to remote
                    </span>
                  ) : checkingConflicts ? (
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </span>
                  ) : conflicts === false ? (
                    <span className="flex items-center gap-1.5 text-xs text-green-400">
                      <Check className="h-3 w-3" />
                      Able to merge
                    </span>
                  ) : conflicts === true ? (
                    <span className="flex items-center gap-1.5 text-xs text-red-400">
                      <X className="h-3 w-3" />
                      Can't automatically merge
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-normal text-zinc-500 font-mono">
                  {headBranch} →
                </span>
                <Popover
                  open={branchPickerOpen}
                  onOpenChange={setBranchPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs font-normal"
                      disabled={creating}
                    >
                      {baseBranch}
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <Command shouldFilter={true}>
                      <CommandInput placeholder="Search branches..." />
                      <CommandList>
                        <CommandEmpty>No branches found</CommandEmpty>
                        {baseBranchOptions.map((branch) => (
                          <CommandItem
                            key={branch}
                            value={branch}
                            onSelect={() => {
                              setBaseBranch(branch)
                              setBranchPickerOpen(false)
                            }}
                          >
                            {branch}
                            {branch === baseBranch && (
                              <Check className="ml-auto h-3 w-3" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* PR title input */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PR title"
            disabled={creating}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowDescription((v) => !v)}
            title={showDescription ? 'Hide description' : 'Show description'}
          >
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                showDescription && '-rotate-180',
              )}
            />
          </Button>
        </div>

        {/* Description textarea (collapsible) */}
        {showDescription && (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="PR description (markdown)"
            rows={4}
            className="flex-shrink-0 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none"
            disabled={creating}
          />
        )}

        {/* Main content: commits + diff viewer */}
        {open && (
          <BranchDiffPanel
            terminalId={terminal.id}
            baseBranch={baseBranch}
            headBranch={headBranch}
            onNoRemote={() => setNoRemote(true)}
          />
        )}

        <DialogFooter className="flex-shrink-0 flex-row justify-end">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={draft}
              onCheckedChange={(v) => setDraft(v === true)}
              disabled={creating}
              className="h-4 w-4"
            />
            Draft
          </label>
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !title.trim() || noRemote}
          >
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
