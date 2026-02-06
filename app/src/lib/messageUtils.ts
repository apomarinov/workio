import type { GroupedMessage, SessionMessage } from '../types'

export function groupMessages(messages: SessionMessage[]): GroupedMessage[] {
  const result: GroupedMessage[] = []
  let currentThinkingGroup: SessionMessage[] = []

  for (const message of messages) {
    if (message.thinking) {
      currentThinkingGroup.push(message)
    } else {
      if (currentThinkingGroup.length > 0) {
        result.push({ type: 'thinking', messages: currentThinkingGroup })
        currentThinkingGroup = []
      }
      result.push({ type: 'message', message })
    }
  }

  if (currentThinkingGroup.length > 0) {
    result.push({ type: 'thinking', messages: currentThinkingGroup })
  }

  return result
}
