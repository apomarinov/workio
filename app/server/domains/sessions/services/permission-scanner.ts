import crypto from 'node:crypto'
import { renderBufferLines } from '@domains/pty/services/buffer-renderer'
import { getSessionBuffer } from '@domains/pty/session'
import {
  getLatestPromptId,
  getMessageByUuid,
  insertPermissionMessage,
} from '@domains/sessions/db'
import type {
  ParsedPermissionPrompt,
  PermissionOption,
  PermissionPromptInput,
  PermissionPromptType,
} from '@domains/sessions/message-types'
import { getIO } from '@server/io'
import { log } from '@server/logger'

// ── Parsing helpers ──────────────────────────────────────────────────

/**
 * Remove all whitespace from a string for spaceless matching.
 * Claude's TUI cursor positioning can cause words to concatenate
 * when ANSI is stripped, so we match against collapsed text.
 */
function collapse(str: string): string {
  return str.replace(/\s+/g, '').toLowerCase()
}

/**
 * Parse numbered options from lines of text.
 * Matches patterns like "1. Yes" or "  2. Yes, allow reading from etc/"
 * Also handles spaceless variants like "1.Yes" or "❯1.Yes"
 */
function parseOptions(lines: string[]): PermissionOption[] {
  const options: PermissionOption[] = []
  for (const line of lines) {
    const match = line.match(/^[\s❯›>]*(\d+)\.\s*(.+)$/)
    if (match) {
      const num = Number.parseInt(match[1], 10)
      const label = match[2].trim()
      if (label.length > 0) {
        options.push({
          number: num,
          label,
          keySequence: String(num),
        })
      }
    }
  }
  return options
}

/**
 * Parse plan mode prompt.
 * Pattern: "Claude has written up a plan and is ready to execute..."
 * Followed by numbered options, ending with "ctrl-g to edit" line.
 */
function parsePlanMode(lines: string[]): ParsedPermissionPrompt | null {
  let planLineIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = collapse(lines[i])
    if (c.includes('planandisreadytoexecute')) {
      planLineIdx = i
      break
    }
  }
  if (planLineIdx === -1) return null

  const question = lines[planLineIdx]

  let endIdx = lines.length
  for (let i = planLineIdx + 1; i < lines.length; i++) {
    const c = collapse(lines[i])
    if (c.includes('ctrl-gtoedit') || c.includes('ctrl+gtoedit')) {
      endIdx = i
      break
    }
  }

  const optionLines = lines.slice(planLineIdx + 1, endIdx)
  const options = parseOptions(optionLines)
  if (options.length === 0) return null

  return {
    type: 'plan_mode',
    title: 'Plan Mode',
    question,
    context: '',
    options,
  }
}

/**
 * Parse tool permission prompt.
 * Matches "Do you want to proceed?" or "Do you want to allow..." using
 * spaceless matching since the TUI cursor positioning can strip spaces.
 */
function parseToolPermission(lines: string[]): ParsedPermissionPrompt | null {
  let questionIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = collapse(lines[i])
    if (c.includes('doyouwanttoproceed') || c.includes('doyouwanttoallow')) {
      questionIdx = i
      break
    }
  }
  if (questionIdx === -1) return null

  const question = lines[questionIdx]

  const optionLines: string[] = []
  for (let i = questionIdx + 1; i < lines.length; i++) {
    const c = collapse(lines[i])
    if (c.includes('esctocancel') || c.includes('tabtoamend')) {
      break
    }
    if (lines[i].length > 0) {
      optionLines.push(lines[i])
    }
  }

  const options = parseOptions(optionLines)
  if (options.length === 0) return null

  let title = ''
  let contextStart = questionIdx
  for (let i = questionIdx - 1; i >= Math.max(0, questionIdx - 15); i--) {
    const line = lines[i]
    if (line.length === 0) continue
    if (/^[─━─-]{3,}$/.test(line)) continue

    let blockTop = i
    for (let j = i - 1; j >= Math.max(0, questionIdx - 20); j--) {
      if (lines[j].length === 0 || /^[─━─-]{3,}$/.test(lines[j])) {
        break
      }
      blockTop = j
    }

    title = lines[blockTop]
    contextStart = blockTop + 1
    break
  }

  const contextLines = lines
    .slice(contextStart, questionIdx)
    .filter((l) => l.length > 0 && !/^[─━─-]{3,}$/.test(l))
  const context = contextLines.join('\n')

  return {
    type: 'tool_permission',
    title: title || 'Permission',
    question,
    context,
    options,
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Scan the PTY buffer for a permission prompt.
 * Returns parsed prompt data or null if no recognized pattern found.
 */
export function scanBufferForPermissionPrompt(buffer: string[]) {
  const lines = renderBufferLines(buffer)

  const planResult = parsePlanMode(lines)
  if (planResult) return planResult

  const toolResult = parseToolPermission(lines)
  if (toolResult) return toolResult

  return null
}

/**
 * Compute a dedup UUID for a permission prompt.
 */
function computePermissionUuid(
  sessionId: string,
  type: PermissionPromptType,
  question: string,
  context: string,
): string {
  const hash = crypto
    .createHash('md5')
    .update(`${sessionId}:${type}:${question}:${context}`)
    .digest('hex')
  return `perm-${hash}`
}

/**
 * Scan a shell's buffer for a permission prompt, store it as a message,
 * and emit via Socket.IO.
 */
export async function scanAndStorePermissionPrompt(
  sessionId: string,
  shellId: number,
) {
  try {
    const buffer = await getSessionBuffer(shellId)
    if (buffer.length === 0) return null

    const parsed = scanBufferForPermissionPrompt(buffer)
    if (!parsed) {
      const lines = renderBufferLines(buffer)
      const lastLines = lines.slice(-20).join('\n')
      log.info(`[permission-scanner] parsed=null, last 20 lines:\n${lastLines}`)
      return null
    }

    log.info(
      `[permission-scanner] parsed: type=${parsed.type} title=${parsed.title} options=${parsed.options.length}`,
    )

    const uuid = computePermissionUuid(
      sessionId,
      parsed.type,
      parsed.question,
      parsed.context,
    )

    // Dedup check
    const existing = await getMessageByUuid(uuid)
    if (existing) return parsed

    // Get latest prompt for this session
    const promptId = await getLatestPromptId(sessionId)
    if (!promptId) {
      log.warn(`[permission-scanner] No prompt found for session ${sessionId}`)
      return null
    }

    const toolData: PermissionPromptInput & {
      name: string
      tool_use_id: string
      status: string
    } = {
      name: 'PermissionPrompt',
      tool_use_id: uuid,
      status: 'pending',
      type: parsed.type,
      title: parsed.title,
      question: parsed.question,
      context: parsed.context,
      options: parsed.options,
    }

    const newMsg = await insertPermissionMessage(
      promptId,
      uuid,
      JSON.stringify(toolData),
    )

    // Emit via Socket.IO
    const io = getIO()
    io?.emit('session_update', {
      session_id: sessionId,
      messages: [newMsg],
    })

    log.info(
      `[permission-scanner] Stored ${parsed.type} prompt for session=${sessionId} uuid=${uuid}`,
    )

    return parsed
  } catch (err) {
    log.error(
      { err },
      `[permission-scanner] Failed to scan/store for session=${sessionId}`,
    )
    return null
  }
}
