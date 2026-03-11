import { useRef } from 'react'
import { cn } from '@/lib/utils'

const REPEAT_DELAY = 400
const REPEAT_INTERVAL = 80

interface ActionButtonProps {
  label?: string
  children?: React.ReactNode
  active?: boolean
  dimmed?: boolean
  withAudio?: boolean
  size?: 'sm' | 'lg'
  preventFocusLoss?: boolean
  repeatable?: boolean
  onTap?: () => void
  className?: string
}

export function ActionButton({
  label,
  children,
  active,
  dimmed,
  withAudio: _withAudio,
  size = 'sm',
  preventFocusLoss,
  repeatable,
  onTap,
  className,
}: ActionButtonProps) {
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const firedRef = useRef(false)

  const isLg = size === 'lg'
  const classes = cn(
    'min-w-10 truncate text-center font-semibold',
    isLg
      ? 'px-2.5 py-1.5 rounded-lg text-base select-none'
      : 'px-2.5 py-2 rounded-md text-xs',
    active
      ? 'bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_3px_rgba(59,130,246,0.4)] ring-1 ring-blue-400/30'
      : cn(
          'bg-gradient-to-b from-zinc-600/80 to-zinc-700/90 text-zinc-200',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.3)]',
          'ring-1 ring-white/[0.06]',
          onTap &&
            'active:from-zinc-600 active:to-zinc-600 active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] active:ring-white/[0.03]',
        ),
    onTap && 'transition-all duration-100',
    dimmed && 'opacity-40',
    className,
  )

  if (!onTap) {
    return <div className={classes}>{children ?? label}</div>
  }

  const playSound = () => {
    // if (withAudio) playPop()
    navigator.vibrate?.(10)
  }

  const clearTimers = () => {
    if (delayRef.current) {
      clearTimeout(delayRef.current)
      delayRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (preventFocusLoss) e.preventDefault()
    playSound()

    if (repeatable) {
      firedRef.current = true
      onTap()
      delayRef.current = setTimeout(() => {
        intervalRef.current = setInterval(() => {
          onTap()
        }, REPEAT_INTERVAL)
      }, REPEAT_DELAY)
    }
  }

  const handlePointerUp = () => {
    if (repeatable) {
      clearTimers()
      return
    }
    if (preventFocusLoss) {
      onTap()
    }
  }

  const handlePointerLeave = () => {
    if (repeatable) clearTimers()
  }

  const handlePointerCancel = () => {
    if (repeatable) clearTimers()
  }

  return (
    <button
      type="button"
      onPointerDown={
        preventFocusLoss || repeatable ? handlePointerDown : undefined
      }
      onPointerUp={preventFocusLoss || repeatable ? handlePointerUp : undefined}
      onPointerLeave={repeatable ? handlePointerLeave : undefined}
      onPointerCancel={repeatable ? handlePointerCancel : undefined}
      onClick={
        preventFocusLoss || repeatable
          ? undefined
          : () => {
              playSound()
              onTap()
            }
      }
      className={classes}
    >
      {children ?? label}
    </button>
  )
}
