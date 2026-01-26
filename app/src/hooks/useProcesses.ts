import { useEffect, useState } from 'react'
import type { ActiveProcess, ProcessesPayload } from '../../shared/types'
import { useSocket } from './useSocket'

export function useProcesses() {
  const { subscribe } = useSocket()
  const [processes, setProcesses] = useState<ActiveProcess[]>([])

  useEffect(() => {
    return subscribe<ProcessesPayload>('processes', (data) => {
      if (data.terminalId !== undefined) {
        // Partial update: replace only processes for this terminal
        setProcesses((prev) => [
          ...prev.filter((p) => p.terminalId !== data.terminalId),
          ...data.processes,
        ])
      } else {
        // Full update: replace all processes
        setProcesses(data.processes)
      }
    })
  }, [subscribe])

  return processes
}
