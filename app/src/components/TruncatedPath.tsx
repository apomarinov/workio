import { cn } from '@/lib/utils'

interface TruncatedPathProps {
  path: string
  className?: string
}

export function TruncatedPath({ path, className = '' }: TruncatedPathProps) {
  return (
    <span
      className={cn('block truncate', className)}
      style={{ direction: 'rtl', textAlign: 'left' }}
    >
      <bdi>{path}</bdi>
    </span>
  )
}
