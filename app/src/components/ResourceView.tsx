import { Cpu, MemoryStick } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ResourceViewMode = 'bar' | 'percent' | 'actual'

interface ResourceViewProps {
  cpuPercent: number
  memPercent: number
  memRssKb?: number
  mode: ResourceViewMode
  className?: string
}

const SEGMENTS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']

function getColor(percent: number, mode = 'bar') {
  if (percent >= 80) return { text: 'text-red-400', bg: 'bg-red-400' }
  if (percent >= 60) return { text: 'text-amber-600', bg: 'bg-amber-600' }
  if (percent >= 40) return { text: 'text-yellow-400', bg: 'bg-yellow-400' }
  if (mode === 'percent' && percent < 2)
    return { text: 'text-muted-foreground', bg: 'bg-muted-foreground' }
  return { text: 'text-blue-400', bg: 'bg-blue-400' }
}

function Bar({ percent }: { percent: number }) {
  const filledCount = Math.round((percent / 100) * SEGMENTS.length)
  const color = getColor(percent)

  return (
    <div className="flex gap-px">
      {SEGMENTS.map((key, i) => (
        <div
          key={key}
          className={cn(
            'h-3 w-[5px] rounded-[1px] first:rounded-l-[3px] last:rounded-r-[3px]',
            i < filledCount ? color.bg : 'bg-muted-foreground/20',
          )}
        />
      ))}
    </div>
  )
}

function formatRssKb(kb: number): string {
  const mb = kb / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

export function ResourceView({
  cpuPercent,
  memPercent,
  memRssKb,
  mode,
  className,
}: ResourceViewProps) {
  if (mode === 'actual') {
    const cpuColor = getColor(cpuPercent, 'percent')
    const memColor = getColor(memPercent, 'percent')
    return (
      <div
        className={cn(
          'flex items-center gap-3 text-xs font-mono flex-wrap',
          className,
        )}
      >
        <span className="flex items-center gap-1">
          <Cpu className="w-3 h-3 text-muted-foreground" />
          <span className={cpuColor.text}>{cpuPercent.toFixed(1)}%</span>
        </span>
        <span className="flex items-center gap-1">
          <MemoryStick className="w-3 h-3 text-muted-foreground" />
          <span className={memColor.text}>
            {memRssKb !== undefined
              ? formatRssKb(memRssKb)
              : `${memPercent.toFixed(1)}%`}
          </span>
        </span>
      </div>
    )
  }

  if (mode === 'percent') {
    const cpuColor = getColor(cpuPercent, 'percent')
    const memColor = getColor(memPercent, 'percent')
    return (
      <div
        className={cn(
          'flex items-center gap-3 text-xs font-mono flex-wrap',
          className,
        )}
      >
        <span className="flex items-center gap-1">
          <Cpu className="w-3 h-3 text-muted-foreground" />
          <span className={cpuColor.text}>{cpuPercent.toFixed(1)}%</span>
        </span>
        <span className="flex items-center gap-1">
          <MemoryStick className="w-3 h-3 text-muted-foreground" />
          <span className={memColor.text}>{memPercent.toFixed(1)}%</span>
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-3 text-xs flex-wrap', className)}>
      <div className="flex items-center gap-1">
        <Cpu className="w-3 h-3 text-muted-foreground" />
        <Bar percent={cpuPercent} />
      </div>
      <div className="flex items-center gap-1">
        <MemoryStick className="w-3 h-3 text-muted-foreground" />
        <Bar percent={memPercent} />
      </div>
    </div>
  )
}
