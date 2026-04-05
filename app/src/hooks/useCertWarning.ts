import { trpc } from '@/lib/trpc'

export function useCertWarning() {
  const { data } = trpc.settings.validateCertIp.useQuery()

  const hasWarning = !!data && data.hasCert && !data.match
  const noCert = !!data && !data.hasCert

  return { hasWarning, noCert, certData: data ?? null }
}
