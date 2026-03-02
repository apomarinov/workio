import { cn } from '@/lib/utils'

// Preload the audio element so iOS doesn't need to fetch on first play
const popAudio =
  typeof window !== 'undefined' ? new Audio('/audio/pop.mp3') : null
if (popAudio) popAudio.load()

function playPop() {
  if (!popAudio) return
  // Clone the node for overlapping plays — clones use the cached source
  const clone = popAudio.cloneNode() as HTMLAudioElement
  clone.play()
}

interface ActionButtonProps {
  label?: string
  children?: React.ReactNode
  active?: boolean
  dimmed?: boolean
  withAudio?: boolean
  size?: 'sm' | 'lg'
  preventFocusLoss?: boolean
  onTap?: () => void
  className?: string
}

export function ActionButton({
  label,
  children,
  active,
  dimmed,
  withAudio = true,
  size = 'sm',
  preventFocusLoss,
  onTap,
  className,
}: ActionButtonProps) {
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
    if (withAudio) playPop()
  }

  return (
    <button
      type="button"
      onPointerDown={
        preventFocusLoss
          ? (e) => {
              e.preventDefault()
              playSound()
            }
          : undefined
      }
      onPointerUp={
        preventFocusLoss
          ? () => {
              onTap()
            }
          : undefined
      }
      onClick={
        preventFocusLoss
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
