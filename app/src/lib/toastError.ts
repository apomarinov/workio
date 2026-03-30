import { toast } from '@/components/ui/sonner'

export function toastError(
  err: unknown,
  fallback = 'Something went wrong',
  toastId?: string | number,
) {
  toast.error(err instanceof Error ? err.message : fallback, { id: toastId })
}
