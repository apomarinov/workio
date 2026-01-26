import { useEffect, useState } from 'react'
import type { ActiveProcess } from '../../shared/types'
import { useSocket } from './useSocket'

export function useProcesses() {
  const { subscribe } = useSocket()
  const [processes, setProcesses] = useState<ActiveProcess[]>([])

  useEffect(() => {
    return subscribe<ActiveProcess[]>('processes', (data) => {
      setProcesses(data)
    })
  }, [subscribe])

  return processes
}
