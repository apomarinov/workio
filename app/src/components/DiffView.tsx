import { cn } from '@/lib/utils'

interface DiffViewProps {
  diff: string
}

export function DiffView({ diff }: DiffViewProps) {
  const lines = diff.split('\n')

  return (
    <div className="font-mono text-xs overflow-x-auto">
      {lines.map((line, i) => (
        <div
          key={`${i}-${line.slice(0, 30)}`}
          className={cn(
            'px-2 whitespace-pre',
            line.startsWith('+') &&
              !line.startsWith('+++') &&
              'bg-green-900/30 text-green-400',
            line.startsWith('-') &&
              !line.startsWith('---') &&
              'bg-red-900/30 text-red-400',
            line.startsWith('@@') && 'text-blue-400',
            line.startsWith('+++') && 'text-zinc-500',
            line.startsWith('---') && 'text-zinc-500',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </div>
  )
}
