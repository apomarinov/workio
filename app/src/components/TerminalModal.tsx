import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  CircleX,
  FolderOpen,
  Loader2,
  Plus,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { toastError } from '@/lib/toastError'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { DirectoryBrowser } from './DirectoryBrowser'
import { ShellPicker } from './ShellPicker'

function FolderPicker({
  value,
  onSelect,
  onClear,
  placeholder = '~',
  sshHost,
}: {
  value: string
  onSelect: (path: string) => void
  onClear: () => void
  placeholder?: string
  sshHost?: string
}) {
  const [browserOpen, setBrowserOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setBrowserOpen(true)}
        className="flex items-center justify-between gap-3 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 py-2 text-sm shadow-xs dark:hover:bg-input/50 hover:bg-accent transition-colors cursor-pointer text-left"
      >
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </div>
        {value && (
          <CircleX
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            className="w-4.5 h-4.5 text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
          />
        )}
      </button>
      <DirectoryBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        value={value}
        onSelect={onSelect}
        sshHost={sshHost}
      />
    </>
  )
}

interface TerminalModalProps {
  onClose: () => void
  onCreated?: (terminalId: number) => void
  /** When set, the modal opens in edit mode for this terminal */
  terminalId?: number
}

export function TerminalModal({
  onClose,
  onCreated,
  terminalId,
}: TerminalModalProps) {
  const { createTerminal, updateTerminal } = useWorkspaceContext()
  const utils = trpc.useUtils()
  const fixMaxSessionsMutation =
    trpc.workspace.system.sshFixMaxSessions.useMutation()

  const isEdit = !!terminalId

  const [form, setForm] = useState({
    name: '',
    shell: '',
    cwd: '',
    sshHost: '',
    gitRepo: '',
    workspacesRoot: '',
    setupScript: '',
    deleteScript: '',
    defaultClaudeCommand: '',
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const [submitting, setSubmitting] = useState(false)
  const [editInitialized, setEditInitialized] = useState(false)

  // Repo picker state
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasGitRepo = form.gitRepo.trim().length > 0
  const isSSH = form.sshHost.length > 0

  // Fetch terminal data in edit mode
  const { data: editTerminal } = trpc.workspace.terminals.getTerminal.useQuery(
    { id: terminalId! },
    { enabled: !!terminalId },
  )

  // Populate form from fetched terminal in edit mode
  useEffect(() => {
    if (editTerminal && !editInitialized) {
      setForm((prev) => ({
        ...prev,
        name: editTerminal.name ?? '',
        shell: editTerminal.shell ?? '',
        sshHost: editTerminal.ssh_host ?? '',
        defaultClaudeCommand: editTerminal.settings?.defaultClaudeCommand ?? '',
      }))
      setEditInitialized(true)
    }
  }, [editTerminal, editInitialized])

  // Load SSH hosts (create mode only)
  const { data: hosts = [], isLoading: loadingHosts } =
    trpc.workspace.system.sshHosts.useQuery(undefined, {
      enabled: !isEdit,
    })

  // Audit SSH MaxSessions when host is selected
  const { data: sshAuditData, isLoading: auditingSSH } =
    trpc.workspace.system.sshAudit.useQuery(
      { host: form.sshHost },
      { enabled: isSSH },
    )
  const sshMaxSessions = sshAuditData?.maxSessions ?? null

  // Get login shell for auto-selection (shares cache with ShellPicker)
  const { data: shellsData, isLoading: loadingShells } =
    trpc.workspace.system.listShells.useQuery({
      host: form.sshHost || undefined,
    })

  // Auto-select login shell when no shell is set
  useEffect(() => {
    if (shellsData?.loginShell && !form.shell) {
      set('shell', shellsData.loginShell)
    }
  }, [shellsData?.loginShell, form.shell])

  // Fetch repos with debounced search
  const { data: repoData, isLoading: isLoadingRepos } =
    trpc.github.repos.useQuery(
      { q: debouncedRepoSearch || undefined },
      { enabled: repoPickerOpen || debouncedRepoSearch.length > 0 },
    )
  const repos = repoData?.repos ?? []

  // Check conductor.json when a git repo is selected
  const { data: conductorData, isLoading: checkingConductor } =
    trpc.github.conductor.useQuery(
      { repo: form.gitRepo.trim() },
      { enabled: hasGitRepo && !isEdit },
    )
  const conductorDetected = conductorData?.hasConductor ?? false

  const handleRepoSearch = useCallback((value: string) => {
    setRepoSearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedRepoSearch(value.trim().toLowerCase())
    }, 200)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isEdit && terminalId) {
      setSubmitting(true)
      try {
        const trimmedCmd = form.defaultClaudeCommand.trim()
        const trimmedShell = form.shell.trim()
        await updateTerminal(terminalId, {
          name: form.name.trim(),
          shell: trimmedShell || null,
          settings: trimmedCmd ? { defaultClaudeCommand: trimmedCmd } : null,
        })
        onClose()
      } catch (err) {
        toastError(err, 'Failed to update project')
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    try {
      const terminal = await createTerminal({
        cwd: hasGitRepo ? '~' : form.cwd.trim() || '~',
        name: form.name.trim() || undefined,
        shell: form.shell.trim() || undefined,
        ssh_host: isSSH ? form.sshHost : undefined,
        git_repo: hasGitRepo ? form.gitRepo.trim() : undefined,
        workspaces_root:
          hasGitRepo && form.workspacesRoot.trim()
            ? form.workspacesRoot.trim()
            : undefined,
        setup_script:
          hasGitRepo && form.setupScript.trim()
            ? form.setupScript.trim()
            : undefined,
        delete_script:
          hasGitRepo && form.deleteScript.trim()
            ? form.deleteScript.trim()
            : undefined,
      })
      onClose()
      onCreated?.(terminal.id)
    } catch (err) {
      toastError(err, 'Failed to create project')
    } finally {
      setSubmitting(false)
    }
  }

  // Filter repos client-side based on current search
  const filteredRepos = repoSearch.trim()
    ? repos.filter((r) =>
        r.toLowerCase().includes(repoSearch.trim().toLowerCase()),
      )
    : repos

  // Show the typed value as an option if it looks like owner/repo and isn't in the list
  const manualEntry =
    repoSearch.trim() &&
    repoSearch.includes('/') &&
    !filteredRepos.some(
      (r) => r.toLowerCase() === repoSearch.trim().toLowerCase(),
    )
      ? repoSearch.trim()
      : null

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-sidebar max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <div className="space-y-2 w-1/2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={isSSH ? 'My Server' : 'My Project'}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2 w-1/2">
              <label htmlFor="shell" className="text-sm font-medium">
                Shell
              </label>
              <ShellPicker
                value={form.shell}
                onChange={(v) => set('shell', v)}
                sshHost={form.sshHost || undefined}
                className="w-full"
              />
            </div>
          </div>

          {isEdit && (
            <div className="space-y-2">
              <label htmlFor="edit-claude-cmd" className="text-sm font-medium">
                Default Claude Command
              </label>
              <Input
                id="edit-claude-cmd"
                value={form.defaultClaudeCommand}
                onChange={(e) => set('defaultClaudeCommand', e.target.value)}
                placeholder="claude"
                disabled={submitting}
              />
            </div>
          )}

          {!isEdit && (
            <div className="space-y-1">
              <label htmlFor="ssh_host" className="text-sm font-medium">
                SSH Host
              </label>
              <Select
                value={form.sshHost}
                onValueChange={(v) => {
                  set('sshHost', v === 'none' ? '' : v)
                  set('shell', '')
                  if (v !== 'none') set('cwd', '')
                }}
              >
                <SelectTrigger
                  id="ssh_host"
                  className={cn(
                    'w-full [&>span]:text-left',
                    form.sshHost && '!h-12',
                  )}
                >
                  <SelectValue
                    placeholder={loadingHosts ? 'Loading...' : 'None'}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {hosts.map((host) => (
                    <SelectItem key={host.alias} value={host.alias}>
                      <div className="flex flex-col">
                        <span>{host.alias}</span>
                        <span className="text-xs text-muted-foreground">
                          {host.user ? `${host.user}@` : ''}
                          {host.hostname}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Hosts from ~/.ssh/config
              </p>
            </div>
          )}

          {isSSH && auditingSSH && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Checking MaxSessions...
            </div>
          )}
          {isSSH &&
            !auditingSSH &&
            sshMaxSessions !== null &&
            sshMaxSessions <= 10 && (
              <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1 text-xs">
                  <span className="text-amber-500 font-medium">
                    MaxSessions is {sshMaxSessions} (default).
                  </span>{' '}
                  <span className="text-muted-foreground">
                    Bump to 64 for better performance.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={fixMaxSessionsMutation.isPending}
                  className="h-6 px-2 text-xs shrink-0"
                  onClick={async () => {
                    try {
                      await fixMaxSessionsMutation.mutateAsync({
                        host: form.sshHost,
                      })
                      toast.success('MaxSessions updated to 64')
                      await utils.workspace.system.sshAudit.invalidate()
                    } catch (err) {
                      toastError(err, 'Failed to fix MaxSessions')
                    }
                  }}
                >
                  {fixMaxSessionsMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    'Fix'
                  )}
                </Button>
              </div>
            )}

          {!isEdit && (
            <div className="border-t-[1px] space-y-2 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Git Repo</label>
                <Popover open={repoPickerOpen} onOpenChange={setRepoPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      type="button"
                      className="w-full justify-between font-normal"
                    >
                      {form.gitRepo || (
                        <span className="text-muted-foreground">
                          Select repo...
                        </span>
                      )}
                      <div className="flex gap-1">
                        {form.gitRepo && (
                          <XCircle
                            onClick={(e) => {
                              e.stopPropagation()
                              set('gitRepo', '')
                              setRepoPickerOpen(false)
                            }}
                            className="w-4 h-4 opacity-50 cursor-pointer hover:opacity-100 !pointer-events-auto"
                          />
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </div>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search repos..."
                        value={repoSearch}
                        onValueChange={handleRepoSearch}
                        isLoading={isLoadingRepos}
                      />
                      {filteredRepos.length > 0 && (
                        <CommandList className="max-h-[300px] overflow-y-auto">
                          {!isLoadingRepos && (
                            <CommandEmpty>
                              {repoSearch.trim()
                                ? 'No repos found. Type owner/repo to add new.'
                                : 'Loading...'}
                            </CommandEmpty>
                          )}
                          <CommandGroup>
                            {manualEntry && !isLoadingRepos && (
                              <CommandItem
                                value={manualEntry}
                                onSelect={() => {
                                  set('gitRepo', manualEntry)
                                  setRepoPickerOpen(false)
                                  setRepoSearch('')
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    form.gitRepo === manualEntry
                                      ? 'opacity-100'
                                      : 'opacity-0',
                                  )}
                                />
                                {manualEntry}
                                <span className="ml-auto text-xs text-muted-foreground">
                                  new
                                </span>
                              </CommandItem>
                            )}
                            {filteredRepos.map((repo) => (
                              <CommandItem
                                key={repo}
                                className="cursor-pointer"
                                value={repo}
                                onSelect={() => {
                                  set(
                                    'gitRepo',
                                    repo === form.gitRepo ? '' : repo,
                                  )
                                  setRepoPickerOpen(false)
                                  setRepoSearch('')
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    form.gitRepo === repo
                                      ? 'opacity-100'
                                      : 'opacity-0',
                                  )}
                                />
                                {repo}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      )}
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              {hasGitRepo && (
                <div className="space-y-2">
                  <label
                    htmlFor="workspaces-root"
                    className="text-sm font-medium"
                  >
                    Clones via SSH into
                  </label>
                  <FolderPicker
                    value={form.workspacesRoot}
                    onSelect={(path) => {
                      set('workspacesRoot', path)
                      set('cwd', '')
                    }}
                    onClear={() => set('workspacesRoot', '')}
                    sshHost={isSSH ? form.sshHost : undefined}
                  />
                </div>
              )}
            </div>
          )}

          {!isEdit && hasGitRepo && (
            <div className="border-t-[1px] space-y-2 pt-2">
              {checkingConductor && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking for conductor.json...
                </div>
              )}

              {!checkingConductor && conductorDetected && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  conductor.json detected — setup and archive scripts will run
                  automatically
                </div>
              )}

              {!checkingConductor && !conductorDetected && (
                <>
                  <div className="space-y-2">
                    <label
                      htmlFor="setup-script"
                      className="text-sm font-medium"
                    >
                      Setup Script
                    </label>
                    <Input
                      id="setup-script"
                      type="text"
                      value={form.setupScript}
                      onChange={(e) => set('setupScript', e.target.value)}
                      placeholder="scripts/setup.sh"
                    />
                    <p className="text-xs text-muted-foreground">
                      Relative path to a setup script run after clone
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="delete-script"
                      className="text-sm font-medium"
                    >
                      Teardown Script
                    </label>
                    <Input
                      id="delete-script"
                      type="text"
                      value={form.deleteScript}
                      onChange={(e) => set('deleteScript', e.target.value)}
                      placeholder="scripts/teardown.sh"
                    />
                    <p className="text-xs text-muted-foreground">
                      Relative path to a script run before workspace deletion
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {!hasGitRepo && !isEdit && (
            <div className="space-y-1">
              <label htmlFor="cwd" className="text-sm font-medium">
                Path
              </label>
              <FolderPicker
                value={form.cwd}
                onSelect={(path) => {
                  set('cwd', path)
                  set('workspacesRoot', '')
                }}
                onClear={() => set('cwd', '')}
                sshHost={isSSH ? form.sshHost : undefined}
              />
              <p className="text-xs text-muted-foreground">
                Git branch and repo will be detected in this path for PR status
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting || auditingSSH || loadingShells}
            className="w-full mt-2"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : !isEdit ? (
              <Plus className="w-4 h-4 mr-2" />
            ) : null}
            {submitting
              ? isEdit
                ? 'Saving...'
                : 'Creating...'
              : isEdit
                ? 'Save'
                : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
