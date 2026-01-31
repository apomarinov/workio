import {
  Check,
  ChevronsUpDown,
  FolderOpen,
  Plus,
  TerminalSquare,
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
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useTerminalContext } from '../context/TerminalContext'
import { useSettings } from '../hooks/useSettings'
import { getGitHubRepos, getSSHHosts, type SSHHostEntry } from '../lib/api'

interface CreateTerminalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (terminalId: number) => void
}

export function CreateTerminalModal({
  open,
  onOpenChange,
  onCreated,
}: CreateTerminalModalProps) {
  const { createTerminal } = useTerminalContext()
  const { settings } = useSettings()
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [shell, setShell] = useState('')
  const [sshHost, setSSHHost] = useState('')
  const [gitRepo, setGitRepo] = useState('')
  const [workspacesRoot, setWorkspacesRoot] = useState('')
  const [conductorEnabled, setConductorEnabled] = useState(false)
  const [setupScript, setSetupScript] = useState('')
  const [deleteScript, setDeleteScript] = useState('')
  const [creating, setCreating] = useState(false)
  const [hosts, setHosts] = useState<SSHHostEntry[]>([])
  const [loadingHosts, setLoadingHosts] = useState(false)

  // Repo picker state
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [repos, setRepos] = useState<string[]>([])
  const [repoSearch, setRepoSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchedQueriesRef = useRef(new Set<string>())

  const defaultShell = settings?.default_shell ?? '/bin/bash'
  const hasGitRepo = gitRepo.trim().length > 0
  const isSSH = sshHost.length > 0
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)

  // Load SSH hosts when modal opens
  useEffect(() => {
    if (open) {
      setLoadingHosts(true)
      getSSHHosts()
        .then(setHosts)
        .catch(() => toast.error('Failed to load SSH hosts'))
        .finally(() => setLoadingHosts(false))
    }
  }, [open])

  // Load initial repos when picker opens
  useEffect(() => {
    if (repoPickerOpen && repos.length === 0) {
      setIsLoadingRepos(true)
      getGitHubRepos()
        .then((r) => {
          setRepos(r)
          fetchedQueriesRef.current.add('')
        })
        .finally(() => {
          setIsLoadingRepos(false)
        })
    }
  }, [repoPickerOpen, repos.length])

  // Search repos with debounce
  const handleRepoSearch = useCallback((value: string) => {
    setRepoSearch(value)
    const q = value.trim().toLowerCase()

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    // Don't re-fetch if we already fetched this query or a prefix that returned results
    if (fetchedQueriesRef.current.has(q)) return
    setIsLoadingRepos(true)
    searchTimerRef.current = setTimeout(() => {
      getGitHubRepos(q)
        .then((r) => {
          fetchedQueriesRef.current.add(q)
          if (r.length > 0) {
            setRepos((prev) => {
              const existing = new Set(prev)
              const merged = [...prev]
              for (const repo of r) {
                if (!existing.has(repo)) merged.push(repo)
              }
              return merged
            })
          }
        })
        .finally(() => {
          setIsLoadingRepos(false)
        })
    }, 200)
  }, [])

  // Reset all state when modal closes
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCwd('')
      setName('')
      setShell('')
      setSSHHost('')
      setGitRepo('')
      setWorkspacesRoot('')
      setConductorEnabled(false)
      setSetupScript('')
      setDeleteScript('')
      setRepos([])
      setRepoSearch('')
      fetchedQueriesRef.current.clear()
    }
    onOpenChange(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setCreating(true)
    try {
      const terminal = await createTerminal({
        cwd: hasGitRepo ? '~' : cwd.trim() || '~',
        name: name.trim() || undefined,
        shell: !isSSH && shell.trim() ? shell.trim() : undefined,
        ssh_host: isSSH ? sshHost : undefined,
        git_repo: hasGitRepo ? gitRepo.trim() : undefined,
        conductor: hasGitRepo && conductorEnabled ? true : undefined,
        workspaces_root:
          hasGitRepo && workspacesRoot.trim()
            ? workspacesRoot.trim()
            : undefined,
        setup_script:
          hasGitRepo && setupScript.trim() ? setupScript.trim() : undefined,
        delete_script:
          hasGitRepo && deleteScript.trim() ? deleteScript.trim() : undefined,
      })
      handleOpenChange(false)
      onCreated?.(terminal.id)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create terminal',
      )
    } finally {
      setCreating(false)
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-sidebar max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Terminal</DialogTitle>
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isSSH ? 'My Server' : 'My Project'}
              />
            </div>

            <div className="space-y-2 w-1/2">
              <label htmlFor="shell" className="text-sm font-medium">
                Shell
              </label>
              <div className="relative">
                <TerminalSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="shell"
                  type="text"
                  value={shell}
                  onChange={(e) => setShell(e.target.value)}
                  placeholder={defaultShell}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="ssh_host" className="text-sm font-medium">
              SSH Host
            </label>
            <Select
              value={sshHost}
              onValueChange={(v) => {
                if (v === 'none') {
                  setSSHHost('')
                  return
                }
                setSSHHost(v)
              }}
            >
              <SelectTrigger
                id="ssh_host"
                className={cn('w-full [&>span]:text-left', sshHost && '!h-12')}
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
                    {gitRepo || (
                      <span className="text-muted-foreground">
                        Select repo...
                      </span>
                    )}
                    <div className="flex gap-1">
                      {gitRepo && (
                        <XCircle
                          onClick={(e) => {
                            e.stopPropagation()
                            setGitRepo('')
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
                                setGitRepo(manualEntry)
                                setRepoPickerOpen(false)
                                setRepoSearch('')
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  gitRepo === manualEntry
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
                                setGitRepo(repo === gitRepo ? '' : repo)
                                setRepoPickerOpen(false)
                                setRepoSearch('')
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  gitRepo === repo
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
                <div className="relative">
                  <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="workspaces-root"
                    type="text"
                    value={workspacesRoot}
                    onChange={(e) => {
                      setWorkspacesRoot(e.target.value)
                      setCwd('')
                    }}
                    placeholder="~/repo-workspaces"
                    className="pl-10"
                  />
                </div>
              </div>
            )}
          </div>

          {hasGitRepo && (
            <div className="border-t-[1px] space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <label
                    htmlFor="conductor"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Conductor
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Runs setup script from conductor.json in repo root
                  </p>
                </div>
                <Switch
                  id="conductor"
                  checked={conductorEnabled}
                  onCheckedChange={(v) => {
                    setConductorEnabled(v)
                    setSetupScript('')
                    setDeleteScript('')
                  }}
                />
              </div>

              {!conductorEnabled && (
                <div className="space-y-2">
                  <label htmlFor="setup-script" className="text-sm font-medium">
                    Setup Script
                  </label>
                  <Input
                    id="setup-script"
                    type="text"
                    value={setupScript}
                    onChange={(e) => {
                      setSetupScript(e.target.value)
                      setConductorEnabled(false)
                    }}
                    placeholder="scripts/setup.sh"
                  />
                  <p className="text-xs text-muted-foreground">
                    Relative path to a setup script run after clone
                  </p>
                </div>
              )}

              {!conductorEnabled && (
                <div className="space-y-2">
                  <label
                    htmlFor="delete-script"
                    className="text-sm font-medium"
                  >
                    Delete Script
                  </label>
                  <Input
                    id="delete-script"
                    type="text"
                    value={deleteScript}
                    onChange={(e) => {
                      setDeleteScript(e.target.value)
                      setConductorEnabled(false)
                    }}
                    placeholder="scripts/teardown.sh"
                  />
                  <p className="text-xs text-muted-foreground">
                    Relative path to a script run before workspace deletion
                  </p>
                </div>
              )}
            </div>
          )}

          {!hasGitRepo && (
            <div className="space-y-2">
              <label htmlFor="cwd" className="text-sm font-medium">
                Path
              </label>
              <div className="relative">
                <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="cwd"
                  type="text"
                  value={cwd}
                  onChange={(e) => {
                    setCwd(e.target.value)
                    setWorkspacesRoot('')
                  }}
                  placeholder="~"
                  className="pl-10"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Git branch and repo will be detected in this path for PR status
              </p>
            </div>
          )}

          <Button type="submit" disabled={creating} className="w-full mt-2">
            <Plus className="w-4 h-4 mr-2" />
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
