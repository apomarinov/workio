import { Bot, ChevronDown, ChevronRight, User } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSettings } from '../hooks/useSettings'
import type { SessionMessage } from '../types'
import { MarkdownContent } from './MarkdownContent'

interface MessageBubbleProps {
  message: SessionMessage
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
      <div className="max-w-[80%]">
        <button
          type="button"
          onClick={() => setIsExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span className="italic">Thinking...</span>
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

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.is_user

  // For user messages, show prompt_text if available, otherwise body
  const displayText =
    isUser && message.prompt_text ? message.prompt_text : message.body

  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#D97757]/20 flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-[#D97757]" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] px-3 py-2 rounded-lg text-sm',
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-sm',
        )}
      >
        {isUser ? displayText : <MarkdownContent content={displayText} />}
      </div>
      {!!isUser && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600/20 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-blue-400" />
        </div>
      )}
    </div>
  )
}
