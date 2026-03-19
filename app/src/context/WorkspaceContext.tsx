import type { SettingsUpdate } from '@domains/settings/schema'
import type { Shell, Terminal } from '@domains/workspace/schema'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  ServicesStatus,
  ShellClient,
  ShellClientsPayload,
  WorkspacePayload,
} from '../../shared/types'
import { useActiveShells } from '../hooks/useActiveShells'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSettings } from '../hooks/useSettings'
import { useShellLastActive } from '../hooks/useShellLastActive'
import { useSocket } from '../hooks/useSocket'
import { trpc } from '../lib/trpc'

interface WorkspaceContextValue {
  terminals: Terminal[]
  shouldMountShell: (
    shellId: number,
    isActive: boolean,
    hasActivity?: boolean,
  ) => boolean
  loading: boolean
  activeTerminal: Terminal | null
  selectTerminal: (id: number) => void
  clearTerminal: () => void
  selectPreviousTerminal: () => void
  createTerminal: (opts: {
    cwd: string
    name?: string
    shell?: string
    ssh_host?: string
    git_repo?: string
    workspaces_root?: string
    setup_script?: string
    delete_script?: string
    source_terminal_id?: number
  }) => Promise<Terminal>
  updateTerminal: (
    id: number,
    updates: {
      name?: string
      settings?: {
        defaultClaudeCommand?: string
        portMappings?: { port: number; localPort: number }[]
      } | null
    },
  ) => Promise<Terminal>
  mapPort: (
    terminalId: number,
    port: number,
    localPort: number,
  ) => Promise<void>
  unmapPort: (terminalId: number, port: number) => Promise<void>
  deleteTerminal: (
    id: number,
    opts?: { deleteDirectory?: boolean },
  ) => Promise<void>
  setTerminalOrder: (value: number[]) => void
  refetch: () => Promise<void>
  cleanupShellOrder: (terminalId: number, shellId: number) => void
  shellClients: Map<number, ShellClient[]>
  allClients: ShellClient[]
  activeShells: Record<number, number>
  activeShellsRef: React.RefObject<Record<number, number>>
  setShell: (terminalId: number, shellId: number) => void
  mountAllShellsTerminalId: number | null
  setMountAllShellsTerminalId: (id: number | null) => void
  collapsedProjectRepos: string[]
  setCollapsedProjectRepos: (
    value: string[] | ((prev: string[]) => string[]),
  ) => void
  orderedTerminals: Terminal[]
  servicesStatus: ServicesStatus | null
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useSocket()
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.workspace.terminals.listTerminals.useQuery()
  const hasEverLoaded = useRef(false)
  if (data) hasEverLoaded.current = true

  const setData = (
    updater: (prev: Terminal[] | undefined) => Terminal[] | undefined,
  ) => {
    utils.workspace.terminals.listTerminals.setData(undefined, updater)
  }

  const { settings, updateSettings } = useSettings()
  const terminalOrder = settings?.terminal_order ?? []
  const setTerminalOrder = (value: number[]) => {
    updateSettings({ terminal_order: value })
  }

  const raw = data ?? []

  const terminals = useMemo(() => {
    if (terminalOrder.length === 0) return raw
    const terminalMap = new Map(raw.map((t) => [t.id, t]))
    const ordered: Terminal[] = []
    for (const id of terminalOrder) {
      const t = terminalMap.get(id)
      if (t) {
        ordered.push(t)
        terminalMap.delete(id)
      }
    }
    for (const t of raw) {
      if (terminalMap.has(t.id)) {
        ordered.push(t)
      }
    }
    return ordered
  }, [raw, terminalOrder])

  // Shell mount tracking: only mount recently-active shells
  const { markInactive, shouldMount: shouldMountShell } =
    useShellLastActive(terminals)

  // Force-mount all shells for a terminal (used during template application)
  const [mountAllShellsTerminalId, _setMountAllShellsTerminalId] = useState<
    number | null
  >(null)
  const mountAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setMountAllShellsTerminalId = (id: number | null) => {
    if (mountAllTimerRef.current) {
      clearTimeout(mountAllTimerRef.current)
      mountAllTimerRef.current = null
    }
    if (id !== null) {
      // Auto-clear after 10s — by then shells have connected and have active_cmd
      mountAllTimerRef.current = setTimeout(() => {
        _setMountAllShellsTerminalId(null)
        mountAllTimerRef.current = null
      }, 10_000)
    }
    _setMountAllShellsTerminalId(id)
  }

  const storedTerminalId = useRef<number | null>(
    (() => {
      const saved = localStorage.getItem('active-terminal-id')
      return saved ? Number(saved) : null
    })(),
  )
  const [_activeTerminalId, setActiveTerminalId] = useState<number | null>(null)
  const previousTerminalIdRef = useRef<number | null>(null)

  // Derive activeTerminalId: prefer stored ID if it still exists
  const activeTerminalId =
    storedTerminalId.current !== null &&
    terminals.some((t) => t.id === storedTerminalId.current)
      ? storedTerminalId.current
      : _activeTerminalId

  // Persist active terminal ID to localStorage
  useEffect(() => {
    if (activeTerminalId !== null) {
      localStorage.setItem('active-terminal-id', String(activeTerminalId))
      storedTerminalId.current = activeTerminalId
    }
  }, [activeTerminalId])

  // Auto-select first terminal when terminals load
  useEffect(() => {
    if (terminals.length > 0 && activeTerminalId === null) {
      setActiveTerminalId(terminals[0].id)
    }
  }, [terminals, activeTerminalId])

  // Clear active terminal if it was deleted
  useEffect(() => {
    if (activeTerminalId && !terminals.find((t) => t.id === activeTerminalId)) {
      setActiveTerminalId(terminals.length > 0 ? terminals[0].id : null)
    }
  }, [terminals, activeTerminalId])

  // Update terminal state in-place when server emits changes
  useEffect(() => {
    return subscribe(
      'terminal:updated',
      ({
        terminalId,
        data,
      }: {
        terminalId: number
        data: Partial<Terminal>
      }) => {
        setData((prev) =>
          prev?.map((t) => (t.id === terminalId ? { ...t, ...data } : t)),
        )
      },
    )
  }, [subscribe, setData])

  // Update shell state in-place when server emits changes
  useEffect(() => {
    return subscribe(
      'shell:updated',
      ({
        terminalId,
        shellId,
        data,
      }: {
        terminalId: number
        shellId: number
        data: Partial<Shell>
      }) => {
        setData((prev) =>
          prev?.map((t) =>
            t.id === terminalId
              ? {
                  ...t,
                  shells: t.shells.map((s) =>
                    s.id === shellId ? { ...s, ...data } : s,
                  ),
                }
              : t,
          ),
        )
      },
    )
  }, [subscribe, setData])

  // Handle terminal:workspace events for state updates
  useEffect(() => {
    return subscribe<WorkspacePayload>('terminal:workspace', (data) => {
      if (data.deleted) {
        setData((prev) => prev?.filter((t) => t.id !== data.terminalId))
        cleanupTerminalOrder(data.terminalId)
        return
      }
      setData((prev) =>
        prev?.map((t) => {
          if (t.id !== data.terminalId) return t
          return {
            ...t,
            ...(data.name && { name: data.name }),
            ...(data.git_repo && { git_repo: data.git_repo }),
            ...(data.setup && { setup: data.setup }),
          }
        }),
      )
    })
  }, [subscribe, setData])

  // Service status tracking
  const [servicesStatus, setServicesStatus] = useState<ServicesStatus | null>(
    null,
  )

  useEffect(() => {
    return subscribe<ServicesStatus>('services:status', setServicesStatus)
  }, [subscribe])

  // Multi-client device tracking per shell
  const [shellClients, setShellClients] = useState<Map<number, ShellClient[]>>(
    () => new Map(),
  )

  useEffect(() => {
    return subscribe<ShellClientsPayload>('shell:clients', (data) => {
      setShellClients((prev) => {
        const next = new Map(prev)
        if (data.clients.length === 0) {
          next.delete(data.shellId)
        } else {
          next.set(data.shellId, data.clients)
        }
        return next
      })
    })
  }, [subscribe])

  const allClients = useMemo(() => {
    const byIp = new Map<string, ShellClient>()
    for (const clients of shellClients.values()) {
      for (const c of clients) {
        const existing = byIp.get(c.ip)
        if (!existing || c.isPrimary) byIp.set(c.ip, c)
      }
    }
    return Array.from(byIp.values())
  }, [shellClients])

  const selectTerminal = useCallback((id: number) => {
    storedTerminalId.current = id
    setActiveTerminalId((prev) => {
      if (prev !== null && prev !== id) {
        previousTerminalIdRef.current = prev
      }
      return id
    })
  }, [])

  const clearTerminal = useCallback(() => {
    storedTerminalId.current = null
    setActiveTerminalId((prev) => {
      if (prev !== null) {
        previousTerminalIdRef.current = prev
      }
      return null
    })
  }, [])

  const selectPreviousTerminal = useCallback(() => {
    const prevId = previousTerminalIdRef.current
    if (prevId !== null && terminals.some((t) => t.id === prevId)) {
      selectTerminal(prevId)
    }
  }, [terminals, selectTerminal])

  const activeTerminal = useMemo(
    () => terminals.find((t) => t.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId],
  )

  // Multi-shell state
  const { activeShells, activeShellsRef, setShell } = useActiveShells(
    terminals,
    activeTerminalId,
    markInactive,
  )

  // Collapsed project repo groups (persisted to localStorage)
  const [collapsedProjectRepos, setCollapsedProjectRepos] = useLocalStorage<
    string[]
  >('sidebar-collapsed-project-repos', [])

  // Flat ordered terminal list matching sidebar render order
  const orderedTerminals = useMemo(() => {
    const collapsedSet = new Set(collapsedProjectRepos)
    const repoGroups = new Map<string, Terminal[]>()
    const ungrouped: Terminal[] = []
    for (const t of terminals) {
      const repo = t.git_repo?.repo
      if (repo) {
        const key = `${repo}::${t.ssh_host || 'local'}`
        const existing = repoGroups.get(key) || []
        existing.push(t)
        repoGroups.set(key, existing)
      } else {
        ungrouped.push(t)
      }
    }
    const ordered: Terminal[] = []
    for (const [key, group] of repoGroups.entries()) {
      if (!collapsedSet.has(key)) ordered.push(...group)
    }
    ordered.push(...ungrouped)
    return ordered
  }, [terminals, collapsedProjectRepos])

  const createMutation = trpc.workspace.terminals.createTerminal.useMutation()
  const updateMutation = trpc.workspace.terminals.updateTerminal.useMutation()
  const deleteMutation = trpc.workspace.terminals.deleteTerminal.useMutation()

  const createTerminal = useCallback(
    async (opts: {
      cwd: string
      name?: string
      shell?: string
      ssh_host?: string
      git_repo?: string
      workspaces_root?: string
      setup_script?: string
      delete_script?: string
      source_terminal_id?: number
    }) => {
      const terminal = await createMutation.mutateAsync(opts)
      setData((prev) => (prev ? [terminal, ...prev] : [terminal]))
      setTerminalOrder([terminal.id, ...terminalOrder])
      return terminal
    },
    [createMutation, terminalOrder, setTerminalOrder, setData],
  )

  const updateTerminal = useCallback(
    async (
      id: number,
      updates: {
        name?: string
        settings?: {
          defaultClaudeCommand?: string
          portMappings?: { port: number; localPort: number }[]
        } | null
      },
    ) => {
      const updated = await updateMutation.mutateAsync({
        id,
        ...updates,
      })
      if (!updated) throw new Error('Terminal not found')
      setData((prev) => prev?.map((t) => (t.id === id ? updated : t)))
      return updated
    },
    [updateMutation, setData],
  )

  const mapPort = useCallback(
    async (terminalId: number, port: number, localPort: number) => {
      const terminal = raw.find((t) => t.id === terminalId)
      if (!terminal) return
      const existing = terminal.settings?.portMappings ?? []
      await updateTerminal(terminalId, {
        settings: {
          ...terminal.settings,
          portMappings: [
            ...existing.filter((m) => m.port !== port),
            { port, localPort },
          ],
        },
      })
    },
    [raw, updateTerminal],
  )

  const unmapPort = useCallback(
    async (terminalId: number, port: number) => {
      const terminal = raw.find((t) => t.id === terminalId)
      if (!terminal) return
      const existing = terminal.settings?.portMappings ?? []
      await updateTerminal(terminalId, {
        settings: {
          ...terminal.settings,
          portMappings: existing.filter((m) => m.port !== port),
        },
      })
    },
    [raw, updateTerminal],
  )

  const cleanupTerminalOrder = (id: number) => {
    const orderUpdates: SettingsUpdate = {}
    if (terminalOrder.includes(id)) {
      orderUpdates.terminal_order = terminalOrder.filter((tid) => tid !== id)
    }
    const shellOrder = settings?.shell_order
    if (shellOrder?.[id]) {
      const { [id]: _, ...rest } = shellOrder
      orderUpdates.shell_order = rest
    }
    if (Object.keys(orderUpdates).length > 0) {
      updateSettings(orderUpdates)
    }
  }

  const deleteTerminal = useCallback(
    async (id: number, opts?: { deleteDirectory?: boolean }) => {
      const result = await deleteMutation.mutateAsync({
        id,
        deleteDirectory: opts?.deleteDirectory,
      })
      if (!result.async) {
        setData((prev) => prev?.filter((t) => t.id !== id))
        cleanupTerminalOrder(id)
      }
    },
    [deleteMutation, setData, cleanupTerminalOrder],
  )

  const cleanupShellOrder = (terminalId: number, shellId: number) => {
    const shellOrder = settings?.shell_order
    const order = shellOrder?.[terminalId]
    if (order?.includes(shellId)) {
      updateSettings({
        shell_order: {
          ...shellOrder,
          [terminalId]: order.filter((id) => id !== shellId),
        },
      })
    }
  }

  const refetch = useCallback(async () => {
    await utils.workspace.terminals.listTerminals.invalidate()
  }, [utils])

  // Listen for refetch events from other clients
  useEffect(() => {
    return subscribe<{ group: string }>('refetch', ({ group }) => {
      if (group === 'terminals')
        utils.workspace.terminals.listTerminals.invalidate()
    })
  }, [subscribe, utils])

  const value = useMemo(
    () => ({
      terminals,
      shouldMountShell,
      loading: isLoading && !hasEverLoaded.current,
      activeTerminal,
      selectTerminal,
      clearTerminal,
      selectPreviousTerminal,
      createTerminal,
      updateTerminal,
      mapPort,
      unmapPort,
      deleteTerminal,
      setTerminalOrder,
      refetch,
      cleanupShellOrder,
      shellClients,
      allClients,
      activeShells,
      activeShellsRef,
      setShell,
      mountAllShellsTerminalId,
      setMountAllShellsTerminalId,
      collapsedProjectRepos,
      setCollapsedProjectRepos,
      orderedTerminals,
      servicesStatus,
    }),
    [
      terminals,
      shouldMountShell,
      isLoading,
      activeTerminal,
      selectTerminal,
      clearTerminal,
      selectPreviousTerminal,
      createTerminal,
      updateTerminal,
      mapPort,
      unmapPort,
      deleteTerminal,
      setTerminalOrder,
      refetch,
      cleanupShellOrder,
      shellClients,
      allClients,
      activeShells,
      activeShellsRef,
      setShell,
      mountAllShellsTerminalId,
      setMountAllShellsTerminalId,
      collapsedProjectRepos,
      setCollapsedProjectRepos,
      orderedTerminals,
      servicesStatus,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspaceContext must be used within WorkspaceProvider')
  }
  return context
}
