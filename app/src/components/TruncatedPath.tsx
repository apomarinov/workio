interface TruncatedPathProps {
  path: string
  className?: string
}

export function TruncatedPath({ path, className = '' }: TruncatedPathProps) {
  return (
    <span
      className={`block truncate ${className}`}
      style={{ direction: 'rtl', textAlign: 'left' }}
    >
      <bdi>{path}</bdi>
    </span>
  )
}
