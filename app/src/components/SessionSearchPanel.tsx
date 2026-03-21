import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleX,
  GitBranch,
  Github,
  Loader2,
  MoreVertical,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { useSessionContext } from '@/context/SessionContext'
import { useEdgeSwipe } from '@/hooks/useEdgeSwipe'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { searchSessionMessages } from '@/lib/api'
import { contextExcerpt, highlightMatch } from '@/lib/search-utils'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { SessionSearchMatch } from '../types'
import { SessionChat } from './SessionChat'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

type NavItem =
  | { type: 'session'; sessionId: string }
  | { type: 'message'; sessionId: string; messageId: number }

export function SessionSearchPanel({
  open,
  onOpenChange,
  onDismiss,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDismiss: () => void
}) {
  const [dismissing, setDismissing] = useState(false)
  const dismiss = () => {
    setDismissing(true)
    onDismiss()
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSearchMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(
    null,
  )
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(
    new Set(),
  )
  const [recentOnly, setRecentOnly] = useState(true)

  const { sessions } = useSessionContext()

  // Extract distinct repos and branches from session data
  const repos = [
    ...new Set(
      sessions
        .flatMap((s) => {
          const entries = s.data?.branches ?? []
          const mainRepo = s.data?.repo
          const repoSet = new Set(entries.map((e) => e.repo))
          if (mainRepo) repoSet.add(mainRepo)
          return [...repoSet]
        })
        .filter(Boolean),
    ),
  ].sort()

  const branches = selectedRepo
    ? [
      ...new Set(
        sessions.flatMap((s) => {
          const entries = s.data?.branches ?? []
          const matching = entries
            .filter((e) => e.repo === selectedRepo)
            .map((e) => e.branch)
          // Also include main branch if repo matches
          if (s.data?.repo === selectedRepo && s.data?.branch) {
            matching.push(s.data.branch)
          }
          return matching
        }),
      ),
    ].sort()
    : []

  const isMobile = useIsMobile()
  const showingChat = isMobile && selectedSessionId != null

  // Start off-screen so the slide-in transition plays even on lazy load
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
  }, [])

  const searchPanelRef = useRef<HTMLDivElement>(null)
  useEdgeSwipe({
    enabled: isMobile && open,
    ref: searchPanelRef,
    direction: 'right',
    onSwipeRight: () => {
      if (selectedSessionId != null) {
        setSelectedSessionId(null)
        setSelectedMessageId(null)
      } else {
        onOpenChange(false)
      }
    },
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const resultsContainerRef = useRef<HTMLDivElement>(null)

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  // Debounced search
  const hasTextQuery = query.length >= 2
  const hasFilter = selectedRepo != null && selectedBranch != null

  useEffect(() => {
    if (!hasTextQuery && !hasFilter) {
      setResults([])
      setLoading(false)
      setSelectedSessionId(null)
      setSelectedMessageId(null)
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      searchAbortRef.current?.abort()
      const controller = new AbortController()
      searchAbortRef.current = controller
      searchSessionMessages(hasTextQuery ? query : null, {
        repo: selectedRepo ?? undefined,
        branch: selectedBranch ?? undefined,
        recentOnly,
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) {
            setResults(data)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            if (err instanceof Error && err.name !== 'AbortError') {
              setLoading(false)
              toast.error(err.message || 'Failed to search sessions')
            }
          }
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      searchAbortRef.current?.abort()
    }
  }, [query, selectedRepo, selectedBranch, recentOnly])

  // Sort results by terminal name
  const sorted = [...results].sort((a, b) => {
    const aName = a.terminal_name ?? ''
    const bName = b.terminal_name ?? ''
    if (aName && !bName) return -1
    if (!aName && bName) return 1
    return aName.localeCompare(bName)
  })

  // Build flat list of navigable items
  const navItems: NavItem[] = []
  for (const match of sorted) {
    navItems.push({ type: 'session', sessionId: match.session_id })
    for (const msg of match.messages) {
      navItems.push({
        type: 'message',
        sessionId: match.session_id,
        messageId: msg.id,
      })
    }
  }

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [results])

  const selectItem = (item: NavItem) => {
    setSelectedSessionId(item.sessionId)
    setSelectedMessageId(item.type === 'message' ? item.messageId : null)
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0) return
    const container = resultsContainerRef.current
    if (!container) return
    const el = container.querySelector(
      `[data-nav-index="${highlightedIndex}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // Track palette open state to suppress key listeners
  const paletteOpenRef = useRef(false)
  useEffect(() => {
    const handler = (e: Event) => {
      paletteOpenRef.current = (e as CustomEvent).detail.open
    }
    window.addEventListener('palette-state', handler)
    return () => window.removeEventListener('palette-state', handler)
  }, [])

  // Keyboard: Esc, ArrowUp, ArrowDown, Enter
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (paletteOpenRef.current) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (query || selectedRepo) {
          setQuery('')
          setSelectedRepo(null)
          setSelectedBranch(null)
          inputRef.current?.focus()
        } else {
          dismiss()
        }
        return
      }

      if (navItems.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next =
          highlightedIndex < navItems.length - 1 ? highlightedIndex + 1 : 0
        setHighlightedIndex(next)
        selectItem(navItems[next])
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next =
          highlightedIndex > 0 ? highlightedIndex - 1 : navItems.length - 1
        setHighlightedIndex(next)
        selectItem(navItems[next])
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, query, onDismiss, navItems.length, highlightedIndex])

  const resultsContent = loading ? (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8">
      <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
    </div>
  ) : results.length === 0 ? (
    <div className="px-4 py-8 text-sm text-zinc-500 text-center">
      {!hasTextQuery && !hasFilter
        ? 'Type to search or filter by repo & branch'
        : 'No matching sessions found'}
    </div>
  ) : (
    <div className="py-1">
      {(() => {
        let navIndex = 0
        return sorted.map((match) => {
          const sessionTitle = match.name ?? match.session_id.slice(0, 12)
          const isSessionSelected = selectedSessionId === match.session_id
          const sessionNavIndex = navIndex++
          return (
            <div key={match.session_id} className="mb-1">
              <div>
                <div className="ml-3 text-[11px] text-zinc-500">
                  {formatDate(match.updated_at)}
                </div>
                <button
                  type="button"
                  data-nav-index={sessionNavIndex}
                  onClick={() =>
                    selectItem({
                      type: 'session',
                      sessionId: match.session_id,
                    })
                  }
                  className={cn(
                    'w-full text-left px-3 pb-1.5 cursor-pointer transition-colors',
                    highlightedIndex === sessionNavIndex
                      ? 'bg-zinc-800'
                      : isSessionSelected && !selectedMessageId
                        ? 'bg-zinc-800/70'
                        : 'hover:bg-zinc-800/50',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-zinc-200 break-all">
                      {sessionTitle}
                    </span>
                  </div>
                  {match.terminal_name && (
                    <div className="mt-0.5 ml-5.5 text-[11px] text-zinc-500 break-all">
                      {match.terminal_name}
                    </div>
                  )}
                  {match.data?.branch && (
                    <div className="mt-0.5 ml-5.5 text-[11px] text-zinc-500">
                      <div className="flex items-center gap-0.5 break-all">
                        <GitBranch className="w-2.5 h-2.5 shrink-0" />
                        {match.data.branch}
                      </div>
                      {match.data.branches &&
                        match.data.branches.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedBranches((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(match.session_id)) {
                                    next.delete(match.session_id)
                                  } else {
                                    next.add(match.session_id)
                                  }
                                  return next
                                })
                              }}
                              className="flex items-center gap-0.5 mt-0.5 text-zinc-600 hover:text-zinc-400 cursor-pointer"
                            >
                              <ChevronDown
                                className={cn(
                                  'w-2.5 h-2.5 transition-transform',
                                  !expandedBranches.has(match.session_id) &&
                                  '-rotate-90',
                                )}
                              />
                              More Branches
                            </button>
                            {expandedBranches.has(match.session_id) &&
                              match.data.branches
                                .filter((e) => e.branch !== match.data?.branch)
                                .map((e) => (
                                  <div
                                    key={`${e.repo}/${e.branch}`}
                                    className="flex items-center gap-0.5 mt-0.5 ml-3 break-all"
                                  >
                                    <GitBranch className="w-2.5 h-2.5 shrink-0" />
                                    {e.branch}
                                  </div>
                                ))}
                          </>
                        )}
                    </div>
                  )}
                </button>
              </div>
              {match.messages.map((msg) => {
                const prefix = msg.is_user ? 'User: ' : 'Claude: '
                const excerpt = contextExcerpt(msg.body, query)
                const isSelected =
                  isSessionSelected && selectedMessageId === msg.id
                const msgNavIndex = navIndex++
                return (
                  <button
                    key={`${match.session_id}:${msg.id}`}
                    type="button"
                    data-nav-index={msgNavIndex}
                    onClick={() =>
                      selectItem({
                        type: 'message',
                        sessionId: match.session_id,
                        messageId: msg.id,
                      })
                    }
                    className={cn(
                      'w-full text-left px-4 py-1.5 text-xs cursor-pointer transition-colors',
                      highlightedIndex === msgNavIndex
                        ? 'bg-zinc-800 text-zinc-200'
                        : isSelected
                          ? 'bg-zinc-800/70 text-zinc-200'
                          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300',
                    )}
                  >
                    <span className="text-zinc-500">{prefix}</span>
                    {highlightMatch(excerpt, query)}
                  </button>
                )
              })}
            </div>
          )
        })
      })()}
    </div>
  )

  const chatContent = selectedSessionId ? (
    <>
      <SessionChat
        sessionId={selectedSessionId}
        hideHeader
        hideAvatars
        loadAll
        scrollToMessageId={selectedMessageId}
      />
      <div className="absolute top-2 left-2 flex items-center gap-1">
        {isMobile && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSelectedSessionId(null)
              setSelectedMessageId(null)
            }}
            className="sm:hidden hover:text-zinc-200 bg-sidebar/60 hover:bg-sidebar"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('open-item-actions', {
                detail: {
                  terminalId: null,
                  sessionId: selectedSessionId,
                },
              }),
            )
          }}
          className="hover:text-zinc-200 bg-sidebar/60 hover:bg-sidebar"
        >
          Actions
          <MoreVertical className="w-4 h-4" />
        </Button>
      </div>
    </>
  ) : (
    <div className="flex items-center justify-center h-full text-sm text-zinc-500">
      Click a result to preview
    </div>
  )

  return (
    <>
      {/* Transparent backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 transition-opacity duration-300',
          open ? 'opacity-100 bg-sidebar/60' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => {
          if (query.length > 0 || selectedRepo != null) {
            onOpenChange(false)
          } else {
            dismiss()
          }
          window.dispatchEvent(new Event('dialog-closed'))
        }}
      />

      {/* Tab handle when collapsed (not dismissing) */}
      {!open && !dismissing && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 px-1 py-4 rounded-l-md border border-r-0 border-zinc-700 transition-colors cursor-pointer"
        >
          <Search className="w-4 h-4" />
        </button>
      )}

      {/* Panel */}
      <div
        ref={searchPanelRef}
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-[100vw] min-w-0 pt-[max(0.5rem,env(safe-area-inset-top))] sm:w-[75%] sm:min-w-[600px] sm:pt-0 bg-zinc-900 border-l border-zinc-700 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out',
          open && mounted ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          {!query && <Search className="w-4 h-4 text-zinc-500 shrink-0" />}
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
            >
              <CircleX className="w-4 h-4" />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search session messages..."
            className="flex-1 bg-transparent text-base sm:text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
          <button
            type="button"
            onClick={dismiss}
            className="text-zinc-500 hover:text-zinc-300 ml-1 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter row */}
        {repos.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-2 pr-4 py-2 border-b border-zinc-800">
            <Select
              value={selectedRepo ?? '__all__'}
              onValueChange={(v) => {
                const repo = v === '__all__' ? null : v
                setSelectedRepo(repo)
                setSelectedBranch(null)
              }}
            >
              <SelectTrigger
                size="sm"
                className="!h-7 text-xs min-w-0 max-w-48"
              >
                <div className="flex items-center gap-2">
                  <Github className="w-3 h-3 max-w-3" />
                  <SelectValue placeholder="All repos" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All repos</SelectItem>
                {repos.map((repo) => (
                  <SelectItem key={repo} value={repo}>
                    {repo.split('/').pop()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 group text-xs font-normal min-w-[150px] max-w-[90vw] w-fit flex justify-between"
                  disabled={!selectedRepo}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-3 h-3 max-w-3" />
                    <span className="truncate">
                      {selectedBranch ?? 'All branches'}
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 ml-1 shrink-0 opacity-50 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command shouldFilter={true}>
                  <CommandInput placeholder="Search branches..." />
                  <CommandList>
                    <CommandEmpty>No branches found</CommandEmpty>
                    <CommandItem
                      value="__all_branches__"
                      onSelect={() => {
                        setSelectedBranch(null)
                        setBranchPickerOpen(false)
                      }}
                    >
                      All branches
                      {selectedBranch == null && (
                        <Check className="ml-auto h-3 w-3" />
                      )}
                    </CommandItem>
                    {branches.map((branch) => (
                      <CommandItem
                        key={branch}
                        value={branch}
                        onSelect={() => {
                          setSelectedBranch(branch)
                          setBranchPickerOpen(false)
                        }}
                      >
                        {branch}
                        {branch === selectedBranch && (
                          <Check className="ml-auto h-3 w-3" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer ml-auto select-none">
              <Checkbox
                checked={recentOnly}
                onCheckedChange={(v) => setRecentOnly(v === true)}
                className="h-4 w-4"
              />
              {recentOnly ? 'Recent' : 'All sessions'}
            </label>
          </div>
        )}

        {/* Body */}
        {isMobile ? (
          <div className="flex-1 relative min-h-0 overflow-hidden">
            {/* Chat layer — always rendered behind */}
            <div className="absolute inset-0">{chatContent}</div>
            {/* Results layer — slides left to reveal chat */}
            <div
              className={cn(
                'absolute inset-0 bg-zinc-900 overflow-y-auto overflow-x-hidden transition-transform duration-300',
                showingChat && '-translate-x-full',
              )}
              ref={resultsContainerRef}
            >
              {resultsContent}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            <div
              className="w-[30%] border-r border-zinc-800 overflow-y-auto"
              ref={resultsContainerRef}
            >
              {resultsContent}
            </div>
            <div className="flex-1 min-h-0 relative">{chatContent}</div>
          </div>
        )}
      </div>
    </>
  )
}
