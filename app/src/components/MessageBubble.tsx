import { Bot, ChevronDown, User } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSettings } from '../hooks/useSettings'
import type { SessionMessage } from '../types'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallDisplay } from './ToolCallDisplay'

interface MessageBubbleProps {
  message: SessionMessage
  hideAvatars?: boolean
}

interface ThinkingGroupProps {
  messages: SessionMessage[]
}

export function ThinkingGroup({ messages }: ThinkingGroupProps) {
  const { settings } = useSettings()
  const [isExpanded, setIsExpanded] = useState<boolean | null>(null)

  const expanded = isExpanded ?? settings?.show_thinking ?? false
  const combinedText = messages.map((m) => m.body).join('\n\n')

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] group">
        <button
          type="button"
          onClick={() => setIsExpanded(!expanded)}
          className="flex items-center cursor-pointer gap-1 text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors"
        >
          <ChevronDown
            className={cn(
              'w-3 h-3 transition-transform',
              !expanded && '-rotate-90',
            )}
          />
          <span className="italic  group-hover:text-zinc-400">Thinking...</span>
        </button>
        {expanded && (
          <div className="mt-1 p-3 bg-zinc-800/50 rounded-lg border border-zinc-800 text-xs text-zinc-400 whitespace-pre-wrap">
            {combinedText}
          </div>
        )}
      </div>
    </div>
  )
}

export function MessageBubble({ message, hideAvatars }: MessageBubbleProps) {
  const isUser = message.is_user

  // If it's a tool message, render ToolCallDisplay
  if (message.tools) {
    return (
      <div className="flex gap-2 justify-start">
        {!hideAvatars && (
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-700/50 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-zinc-400" />
          </div>
        )}
        <div className="max-w-[85%] px-3 py-2 rounded-lg text-sm bg-zinc-800/50 border border-zinc-700/50 rounded-bl-sm">
          <ToolCallDisplay tool={message.tools} />
        </div>
      </div>
    )
  }

  const displayText = message.body
  const hasImages = message.images && message.images.length > 0

  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && !hideAvatars && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#D97757]/20 flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-[#D97757]" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] break-all px-3 py-2 rounded-lg text-sm',
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-sm',
        )}
      >
        {hasImages && (
          <div className="flex flex-col gap-2 mb-2">
            {message.images!.map((img, idx) => (
              <img
                key={`${message.id}-img-${img.data.slice(0, 16)}`}
                src={`data:${img.media_type};base64,${img.data}`}
                alt={`Attached image ${idx + 1}`}
                className="max-w-full max-h-96 rounded object-contain"
              />
            ))}
          </div>
        )}
        {displayText && <MarkdownContent content={displayText || ''} />}
      </div>
      {!!isUser && !hideAvatars && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600/20 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-blue-400" />
        </div>
      )}
    </div>
  )
}
