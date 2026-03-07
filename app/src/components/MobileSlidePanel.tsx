import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MobileSlidePanelProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function MobileSlidePanel({
  open,
  onClose,
  title,
  children,
}: MobileSlidePanelProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] transition-opacity duration-300',
          open ? 'opacity-100 bg-black/50' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-[60] w-[85%] max-w-[320px] bg-zinc-900 border-r border-zinc-700 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
          <span className="text-sm font-medium text-zinc-200">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-hidden min-h-0">{children}</div>
      </div>
    </>
  )
}
