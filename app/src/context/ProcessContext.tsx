import { resolveNotification } from '@domains/notifications/registry'
import type {
  ActiveProcess,
  GitDiffStat,
  GitDirtyPayload,
  GitLastCommit,
  GitRemoteSyncPayload,
  HostResourceInfo,
  PortForwardStatus,
  ProcessesPayload,
  ResourceUsage,
} from '@domains/pty/schema'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useSocket } from '@/hooks/useSocket'
import { useNotifications } from './NotificationContext'

export interface ResourceInfo {
  totalRam: number
  totalCpu: number
  usage: Record<number, ResourceUsage>
  systemCpu: number // total system CPU usage (sum of all %cpu)
  systemRss: number // total system RSS in KB
  hostResources: Record<string, HostResourceInfo> // per SSH host
}

interface ProcessContextValue {
  processes: ActiveProcess[]
  terminalPorts: Record<number, number[]>
  shellPorts: Record<number, number[]>
  portForwardStatus: Record<number, PortForwardStatus[]>
  resourceInfo: ResourceInfo
  gitDirtyStatus: Record<number, GitDiffStat>
  gitRemoteSyncStatus: Record<
    number,
    { behind: number; ahead: number; noRemote: boolean }
  >
  gitLastCommit: Record<number, GitLastCommit>
  subscribeToBell: (
    shellId: number,
    terminalId: number,
    command: string,
    terminalName: string,
  ) => void
  unsubscribeFromBell: (shellId: number) => void
  isBellSubscribed: (shellId: number) => boolean
}

const ProcessContext = createContext<ProcessContextValue | null>(null)

const EMPTY_RESOURCE_INFO: ResourceInfo = {
  totalRam: 0,
  totalCpu: 0,
  usage: {},
  systemCpu: 0,
  systemRss: 0,
  hostResources: {},
}

export function ProcessProvider({ children }: { children: React.ReactNode }) {
  const { subscribe, emit } = useSocket()
  const { sendNotification } = useNotifications()

  const [processes, setProcesses] = useState<ActiveProcess[]>([])
  const [terminalPorts, setTerminalPorts] = useState<Record<number, number[]>>(
    {},
  )
  const [shellPorts, setShellPorts] = useState<Record<number, number[]>>({})
  const [portForwardStatus, setPortForwardStatus] = useState<
    Record<number, PortForwardStatus[]>
  >({})
  const [resourceInfo, setResourceInfo] =
    useState<ResourceInfo>(EMPTY_RESOURCE_INFO)
  const [gitDirtyStatus, setGitDirtyStatus] = useState<
    Record<number, GitDiffStat>
  >({})
  const [gitRemoteSyncStatus, setGitRemoteSyncStatus] = useState<
    Record<number, { behind: number; ahead: number; noRemote: boolean }>
  >({})
  const [gitLastCommit, setGitLastCommit] = useState<
    Record<number, GitLastCommit>
  >({})

  // Bell subscriptions (server-side, synced via socket)
  const [bellShellIds, setBellShellIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    return subscribe<GitDirtyPayload>('git:dirty-status', (data) => {
      setGitDirtyStatus((prev) => {
        const next = data.dirtyStatus
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const key of nextKeys) {
          const p = prev[Number(key)]
          const n = next[Number(key)]
          if (
            !p ||
            !n ||
            p.added !== n.added ||
            p.removed !== n.removed ||
            p.untracked !== n.untracked
          )
            return next
        }
        return prev
      })
      if (data.lastCommit) {
        setGitLastCommit((prev) => {
          const next = data.lastCommit!
          const prevKeys = Object.keys(prev)
          const nextKeys = Object.keys(next)
          if (prevKeys.length !== nextKeys.length) return next
          for (const key of nextKeys) {
            const p = prev[Number(key)]
            const n = next[Number(key)]
            if (!p || !n || p.hash !== n.hash) return next
          }
          return prev
        })
      }
    })
  }, [subscribe])

  useEffect(() => {
    return subscribe<GitRemoteSyncPayload>('git:remote-sync', (data) => {
      setGitRemoteSyncStatus((prev) => {
        const next = data.syncStatus
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const key of nextKeys) {
          const p = prev[Number(key)]
          const n = next[Number(key)]
          if (
            !p ||
            !n ||
            p.behind !== n.behind ||
            p.ahead !== n.ahead ||
            p.noRemote !== n.noRemote
          )
            return next
        }
        return prev
      })
    })
  }, [subscribe])

  useEffect(() => {
    return subscribe<ProcessesPayload>('processes', (data) => {
      if (data.terminalId !== undefined) {
        setProcesses((prev) => [
          ...prev.filter((p) => p.terminalId !== data.terminalId),
          ...data.processes,
        ])
      } else {
        setProcesses(data.processes)
      }

      if (data.ports) {
        setTerminalPorts((prev) => {
          if (data.terminalId !== undefined) {
            const next = { ...prev }
            const ports = data.ports?.[data.terminalId]
            if (ports && ports.length > 0) {
              next[data.terminalId] = ports
            } else {
              delete next[data.terminalId]
            }
            return next
          }
          return data.ports ?? {}
        })
      }

      if (data.shellPorts) {
        setShellPorts((prev) => {
          if (data.terminalId !== undefined) {
            // Partial update: merge shell ports for this terminal's shells
            const next = { ...prev }
            for (const [shellId, ports] of Object.entries(data.shellPorts!)) {
              if (ports.length > 0) {
                next[Number(shellId)] = ports
              } else {
                delete next[Number(shellId)]
              }
            }
            return next
          }
          return data.shellPorts ?? {}
        })
      }

      if (data.terminalId !== undefined) {
        // Per-terminal update: set or clear this terminal's forward status
        const tid = data.terminalId
        setPortForwardStatus((prev) => {
          const statuses = data.portForwardStatus?.[tid]
          if (statuses && statuses.length > 0) {
            return { ...prev, [tid]: statuses }
          }
          if (prev[tid]) {
            const next = { ...prev }
            delete next[tid]
            return next
          }
          return prev
        })
      } else if (data.portForwardStatus) {
        // Full update: replace all
        setPortForwardStatus(data.portForwardStatus)
      }

      if (
        data.resourceUsage ||
        data.systemMemory ||
        data.cpuCount ||
        data.hostResources
      ) {
        setResourceInfo((prev) => {
          const totalRam = data.systemMemory ?? prev.totalRam
          const totalCpu = data.cpuCount ?? prev.totalCpu
          const systemCpu = data.systemCpu ?? prev.systemCpu
          const systemRss = data.systemRss ?? prev.systemRss
          let usage: Record<number, ResourceUsage>
          if (data.resourceUsage) {
            if (data.terminalId !== undefined) {
              // Partial update: merge resource usage for this terminal's shells
              usage = { ...prev.usage }
              for (const [shellId, u] of Object.entries(data.resourceUsage)) {
                usage[Number(shellId)] = u
              }
            } else {
              usage = data.resourceUsage
            }
          } else {
            usage = prev.usage
          }
          let hostResources: Record<string, HostResourceInfo>
          if (data.hostResources) {
            if (data.terminalId !== undefined) {
              hostResources = { ...prev.hostResources, ...data.hostResources }
            } else {
              hostResources = data.hostResources
            }
          } else {
            hostResources = prev.hostResources
          }
          return {
            totalRam,
            totalCpu,
            usage,
            systemCpu,
            systemRss,
            hostResources,
          }
        })
      }
    })
  }, [subscribe])

  // Play bell sound when server detects \x07 in PTY output
  useEffect(() => {
    return subscribe<{ shellId: number; terminalId: number }>(
      'pty:bell',
      () => {
        const audio = new Audio('/audio/bell.mp3')
        audio.volume = 0.8
        audio.play().catch(() => {})
      },
    )
  }, [subscribe])

  // Sync bell subscriptions from server
  useEffect(() => {
    return subscribe<number[]>('bell:subscriptions', (shellIds) => {
      setBellShellIds(new Set(shellIds))
    })
  }, [subscribe])

  // Bell notification from server when command ends
  useEffect(() => {
    return subscribe<{
      shellId: number
      terminalId: number
      command: string
      terminalName: string
      exitCode: number
    }>('bell:notify', (data) => {
      const resolved = resolveNotification('bell_notify', data)
      sendNotification(`${resolved.emoji} ${resolved.title}`, {
        body: resolved.body,
        audio: resolved.audio,
      })
    })
  }, [subscribe, sendNotification])

  const subscribeToBell = (
    shellId: number,
    terminalId: number,
    command: string,
    terminalName: string,
  ) => {
    emit('bell:subscribe', { shellId, terminalId, command, terminalName })
  }

  const unsubscribeFromBell = (shellId: number) => {
    emit('bell:unsubscribe', { shellId })
  }

  const isBellSubscribed = (shellId: number) => {
    return bellShellIds.has(shellId)
  }

  const value = useMemo(
    () => ({
      processes,
      terminalPorts,
      shellPorts,
      portForwardStatus,
      resourceInfo,
      gitDirtyStatus,
      gitRemoteSyncStatus,
      gitLastCommit,
      subscribeToBell,
      unsubscribeFromBell,
      isBellSubscribed,
    }),
    [
      processes,
      terminalPorts,
      shellPorts,
      portForwardStatus,
      resourceInfo,
      gitDirtyStatus,
      gitRemoteSyncStatus,
      gitLastCommit,
      bellShellIds,
    ],
  )

  return (
    <ProcessContext.Provider value={value}>{children}</ProcessContext.Provider>
  )
}

export function useProcessContext() {
  const context = useContext(ProcessContext)
  if (!context) {
    throw new Error('useProcessContext must be used within ProcessProvider')
  }
  return context
}
