import { useEffect } from 'react'
import useSWR from 'swr'
import type { ActivePermission } from '../lib/api'
import * as api from '../lib/api'
import { useSocket } from './useSocket'

export function useActivePermissions() {
  const { subscribe } = useSocket()
  const { data, mutate } = useSWR<ActivePermission[]>(
    '/api/permissions/active',
    api.getActivePermissions,
    { revalidateOnFocus: false },
  )

  // Refetch on session_update (new permission messages arrive)
  useEffect(() => {
    return subscribe('session_update', () => {
      mutate()
    })
  }, [subscribe, mutate])

  // Refetch on hook events (status changes like permission_needed → active)
  useEffect(() => {
    return subscribe('hook', () => {
      mutate()
    })
  }, [subscribe, mutate])

  const permissions = data ?? []

  useEffect(() => {
    console.log('[permissions] active:', permissions)
  }, [permissions])

  return permissions
}
