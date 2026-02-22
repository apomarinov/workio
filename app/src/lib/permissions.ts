import type {
  PermissionOption,
  PermissionPromptType,
  Session,
  SessionMessage,
} from '../types'

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionData {
  question: string
  header?: string
  options: AskUserQuestionOption[]
  multiSelect?: boolean
}

export interface ActivePermissionQuestion {
  sessionId: string
  shellId: number | null
  messageId: number
  source: 'ask_user_question' | 'terminal_prompt'
  // For AskUserQuestion:
  questions?: AskUserQuestionData[]
  answers?: Record<string, string>
  // For terminal prompts:
  promptType?: PermissionPromptType
  title?: string
  question?: string
  context?: string
  options?: PermissionOption[]
}

/**
 * Extract active (unanswered) permission questions from session messages.
 * Only returns questions when session.status === 'permission_needed'.
 */
export function getActivePermissionQuestions(
  session: Session,
  messages: SessionMessage[],
): ActivePermissionQuestion[] {
  if (session.status !== 'permission_needed') return []

  const results: ActivePermissionQuestion[] = []

  // Scan recent messages (newest first — messages array is already oldest-first in display,
  // so we iterate from the end)
  const recentMessages = messages.slice(-10)

  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i]
    if (msg.is_user || !msg.tools) continue

    const tools = msg.tools as unknown as Record<string, unknown>
    const toolName = tools.name as string | undefined

    // AskUserQuestion — unanswered when no answers field
    if (toolName === 'AskUserQuestion' && !tools.answers) {
      const input = tools.input as Record<string, unknown> | undefined
      const questions = input?.questions as AskUserQuestionData[] | undefined
      if (questions) {
        results.push({
          sessionId: session.session_id,
          shellId: session.shell_id,
          messageId: msg.id,
          source: 'ask_user_question',
          questions,
        })
        break // Only return the latest unanswered question
      }
    }

    // PermissionPrompt — unanswered when status is 'pending'
    if (toolName === 'PermissionPrompt' && tools.status === 'pending') {
      results.push({
        sessionId: session.session_id,
        shellId: session.shell_id,
        messageId: msg.id,
        source: 'terminal_prompt',
        promptType: tools.type as PermissionPromptType,
        title: tools.title as string,
        question: tools.question as string,
        context: tools.context as string,
        options: tools.options as PermissionOption[],
      })
      break // Only return the latest unanswered question
    }
  }

  return results
}
