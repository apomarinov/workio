import {
  AlertTriangle,
  Bot,
  CheckIcon,
  ChevronDown,
  Folder,
  MoreVertical,
  Pin,
  PinOff,
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useSessionContext } from '../context/SessionContext'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSettings } from '../hooks/useSettings'
import type { SessionWithProject } from '../types'
import { MarkdownContent } from './MarkdownContent'
import { TruncatedPath } from './TruncatedPath'

interface SessionItemProps {
  session: SessionWithProject
  showGitBranch?: boolean
  defaultCollapsed?: boolean
  terminalName?: string | null
  popoverContainer?: HTMLElement | null
  onClick?: () => void
}

export const SessionItem = memo(function SessionItem({
  session,
  terminalName,
  defaultCollapsed,
  showGitBranch,
  popoverContainer,
  onClick,
}: SessionItemProps) {
  const { activeSessionId, selectSession } = useSessionContext()
  const { settings } = useSettings()
  const [isFlashing, setIsFlashing] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [pinnedSessions, setPinnedSessions] = useLocalStorage<string[]>(
    'sidebar-pinned-sessions',
    [],
  )
  const isPinned = pinnedSessions.includes(session.session_id)
  const [collapsedSessions, setCollapsedSessions] = useLocalStorage<string[]>(
    'sidebar-collapsed-sessions',
    [],
  )
  const inList = collapsedSessions.includes(session.session_id)
  const isExpanded = popoverContainer
    ? true
    : defaultCollapsed
      ? inList
      : !inList
  const displayName = terminalName || session.name || 'Untitled'
  const isSelected = activeSessionId === session.session_id

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (popoverContainer) {
      return
    }
    setCollapsedSessions((prev) =>
      prev.includes(session.session_id)
        ? prev.filter((id) => id !== session.session_id)
        : [...prev, session.session_id],
    )
  }

  const handleClick = () => {
    if (!isExpanded) {
      setCollapsedSessions((prev) =>
        prev.filter((id) => id !== session.session_id),
      )
    }
    if (onClick) {
      onClick()
    } else {
      selectSession(session.session_id)
    }
  }

  useEffect(() => {
    const handleFlash = (e: CustomEvent<{ sessionId: string }>) => {
      if (e.detail.sessionId === session.session_id) {
        setIsFlashing(true)
        setTimeout(() => setIsFlashing(false), 2100)
      }
    }
    window.addEventListener('flash-session', handleFlash as EventListener)
    return () =>
      window.removeEventListener('flash-session', handleFlash as EventListener)
  }, [session.session_id])

  const statusColor = {
    started: 'text-green-500',
    active: 'text-[#D97757]',
    done: 'text-gray-500',
    ended: 'text-gray-500',
    permission_needed: 'text-[#D97757]',
    idle: 'text-gray-400',
  }[session.status]

  const handleOpenActions = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(
      new CustomEvent('open-item-actions', {
        detail: { terminalId: null, sessionId: session.session_id },
      }),
    )
  }

  const togglePinned = (sessionId: string) => {
    setShowMenu(false)
    setPinnedSessions((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId],
    )
  }

  const showUserMessage =
    session.latest_user_message &&
    (session.latest_user_message !== displayName ||
      (displayName.length > 50 &&
        session.latest_user_message.indexOf(displayName) !== 0))
  const isSmall =
    (!session.latest_user_message && !session.latest_agent_message) ||
    !isExpanded

  return (
    <div
      data-session-id={session.session_id}
      onClick={handleClick}
      className={cn(
        'group flex overflow-hidden items-stretch gap-2 px-2 py-1.5 rounded text-sidebar-foreground/70 hover:bg-sidebar-accent/30 transition-colors cursor-pointer relative',
        isFlashing && 'animate-flash',
        isSelected && 'bg-sidebar-accent/50',
      )}
    >
      <div className="flex items-start z-[1] gap-1 mt-[1px] relative">
        <div className="icons group-hover:hidden">
          {session.status === 'done' && (
            <CheckIcon className="w-3.5 h-3.5 text-green-500/70" />
          )}
          {(session.status === 'active' ||
            (!isSmall && session.status === 'permission_needed')) && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 300 150"
              className="w-3.5 h-3.5"
            >
              <path
                fill="none"
                stroke="#D97757"
                strokeWidth="40"
                strokeLinecap="round"
                strokeDasharray="300 385"
                strokeDashoffset="0"
                d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  calcMode="spline"
                  dur="2s"
                  values="685;-685"
                  keySplines="0 0 1 1"
                  repeatCount="indefinite"
                />
              </path>
            </svg>
          )}
          {session.status === 'permission_needed' && (
            <AlertTriangle
              className={cn(
                'w-3.5 h-3.5 flex-shrink-0 text-yellow-500 animate-pulse',
              )}
            />
          )}
          {!['active', 'permission_needed', 'done'].includes(
            session.status,
          ) && (
            <Bot
              className={cn('w-3.5 h-3.5 flex-shrink-0', statusColor)}
              aria-label={session.status}
            />
          )}
        </div>
        <button
          type="button"
          onClick={toggleExpanded}
          className="hidden cursor-pointer group-hover:block"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
          />
        </button>
      </div>
      <div className="flex-1 min-w-0 max-w-[100%]">
        {isExpanded ? (
          <>
            <span
              style={{
                lineHeight: showGitBranch ? '' : undefined,
              }}
              className={cn(
                'text-xs block whitespace-break-spaces break-all',
                showGitBranch && '',
              )}
            >
              {displayName.slice(0, 200)}
              {displayName.length > 200 ? '...' : ''}
            </span>
            {showGitBranch && session.project_path && (
              <span
                className={cn(
                  'flex -ml-5 items-center gap-1 text-[10px] text-muted-foreground',
                )}
              >
                <Folder className={cn('w-2.5 h-2.5 mr-1')} />
                <TruncatedPath path={session.project_path} />
              </span>
            )}
            {showUserMessage && session.latest_user_message && (
              <div className="text-xs line-clamp-3 text-muted-foreground py-0.5 my-1">
                <MarkdownContent content={session.latest_user_message} />
              </div>
            )}
            {session.latest_agent_message && (
              <div className="relative w-full h-fit">
                {isExpanded && (
                  <div className={cn('absolute top-1/2 left-[-15px]')}>
                    <div className="w-[15px] border-l-[1px] border-b-[1px] h-[1220px] -translate-y-full"></div>
                  </div>
                )}
                <div
                  className="text-xs border-[1px] rounded-md line-clamp-3 px-2 text-muted-foreground py-0.5 my-1"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: settings?.message_line_clamp ?? 5,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  <MarkdownContent content={session.latest_agent_message} />
                </div>
              </div>
            )}
          </>
        ) : (
          <span className="text-xs truncate block">{displayName}</span>
        )}
      </div>
      <div
        className={cn(
          'bg-sidebar w-5 h-6 absolute top-0 left-0 group-hover:bg-[#1b1b1b]',
          isSelected ? 'bg-[#1f1f1f]' : '',
        )}
      ></div>
      {isPinned && (
        <div className="absolute top-1 right-1 group-hover:invisible">
          <Pin className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
      <div className="absolute invisible group-hover:visible top-1 right-1">
        {popoverContainer ? (
          <Popover open={showMenu} onOpenChange={setShowMenu}>
            <PopoverTrigger asChild>
              <Button
                variant={'secondary'}
                size="icon"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'h-7 w-7 text-muted-foreground !w-[20px]',
                  isSmall && 'w-3.5 h-3.5 rounded-sm !py-[10px]',
                )}
              >
                <MoreVertical className="w-3 h-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-36 p-1"
              container={popoverContainer}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => togglePinned(session.session_id)}
                className="flex cursor-pointer items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-sidebar-accent/50 text-left"
              >
                {isPinned ? (
                  <>
                    <PinOff className="w-3.5 h-3.5" />
                    Unpin
                  </>
                ) : (
                  <>
                    <Pin className="w-3.5 h-3.5" />
                    Pin
                  </>
                )}
              </button>
            </PopoverContent>
          </Popover>
        ) : (
          <Button
            variant={'secondary'}
            size="icon"
            onClick={handleOpenActions}
            className={cn(
              'h-7 w-7 text-muted-foreground !w-[20px]',
              isSmall && 'w-3.5 h-3.5 rounded-sm !py-[10px]',
            )}
          >
            <MoreVertical className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  )
})
