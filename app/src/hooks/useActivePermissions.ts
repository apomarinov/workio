import { useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { useSocket } from './useSocket'

export function useActivePermissions() {
  const { subscribe } = useSocket()
  const { data, refetch } = trpc.sessions.activePermissions.useQuery(
    undefined,
    { refetchOnWindowFocus: false },
  )

  // Refetch on session_update (new permission messages arrive)
  useEffect(() => {
    return subscribe('session_update', () => {
      refetch()
    })
  }, [subscribe, refetch])

  // Refetch on hook events (status changes like permission_needed → active)
  useEffect(() => {
    return subscribe('hook', () => {
      refetch()
    })
  }, [subscribe, refetch])

  return data ?? []
}
