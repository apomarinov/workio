import {
  Check,
  ChevronDown,
  GitCommitHorizontal,
  Loader2,
  X,
} from 'lucide-react'
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
  getCommitsBetween,
  type PRCommit,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Terminal } from '../../types'
import { DiffViewerPanel } from '../DiffViewerPanel'

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
  const [commits, setCommits] = useState<PRCommit[]>([])
  const [loadingCommits, setLoadingCommits] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [noRemote, setNoRemote] = useState(false)
  const [creating, setCreating] = useState(false)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)

  // Compute diff base for DiffViewerPanel
  const diffBase = selectedCommit
    ? `${selectedCommit}^..${selectedCommit}`
    : `origin/${baseBranch}...origin/${headBranch}`

  // Fetch conflicts + commits when base branch changes
  useEffect(() => {
    if (!open) return
    setConflicts(null)
    setCommits([])
    setSelectedCommit(null)
    setNoRemote(false)

    setCheckingConflicts(true)
    setLoadingCommits(true)

    Promise.all([
      checkBranchConflicts(terminal.id, headBranch, baseBranch)
        .then((data) => setConflicts(data.hasConflicts))
        .catch(() => setConflicts(null))
        .finally(() => setCheckingConflicts(false)),
      getCommitsBetween(terminal.id, baseBranch, headBranch)
        .then((data) => {
          setCommits(data.commits)
          if (data.noRemote) setNoRemote(true)
        })
        .catch(() => setCommits([]))
        .finally(() => setLoadingCommits(false)),
    ])
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
      setCommits([])
      setSelectedCommit(null)
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
        className="w-[95vw] p-4 sm:max-w-[1500px] h-[95vh] max-h-[1500px] flex flex-col overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-3">
              <span>Create Pull Request</span>
              <span className="text-xs font-normal text-zinc-500 font-mono">
                {headBranch} → {baseBranch}
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
        <div className="flex-1 min-h-0 flex gap-0 overflow-hidden rounded-md border border-zinc-700">
          {/* Left column: commit list */}
          <div className="w-[220px] flex-shrink-0 border-r border-zinc-700 flex flex-col overflow-hidden">
            <div className="px-2 py-1.5 border-b border-zinc-700">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">
                Commits ({commits.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingCommits ? (
                <div className="flex items-center justify-center py-4 text-sm text-zinc-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : commits.length === 0 ? (
                <div className="py-4 text-center text-sm text-zinc-500">
                  No commits
                </div>
              ) : (
                commits.map((commit) => (
                  <div
                    key={commit.hash}
                    className={cn(
                      'flex items-start gap-2 px-2 py-2 text-xs cursor-pointer hover:bg-zinc-800/50',
                      selectedCommit === commit.hash && 'bg-zinc-700/50',
                    )}
                    onClick={() =>
                      setSelectedCommit(
                        selectedCommit === commit.hash ? null : commit.hash,
                      )
                    }
                  >
                    <GitCommitHorizontal
                      className={cn(
                        'h-3.5 w-3.5 mt-0.5 flex-shrink-0',
                        selectedCommit === commit.hash
                          ? 'text-blue-400'
                          : 'text-zinc-500',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-zinc-300">{commit.message}</div>
                      <div className="text-zinc-500 font-mono">
                        {commit.hash.slice(0, 7)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: diff viewer panel (without outer border since we already have one) */}
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
            <DiffViewerPanel
              integrated
              terminalId={terminal.id}
              base={diffBase}
              readOnly
            />
          </div>
        </div>

        <DialogFooter className="flex-shrink-0">
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
