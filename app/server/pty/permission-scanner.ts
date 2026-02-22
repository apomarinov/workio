import crypto from 'node:crypto'
import type {
  PermissionOption,
  PermissionPromptInput,
  PermissionPromptType,
} from '../../src/types'
import {
  getLatestPromptId,
  getMessageByUuid,
  insertPermissionMessage,
} from '../db'
import { getIO } from '../io'
import { log } from '../logger'
import { getSessionBuffer } from './manager'

/**
 * Render raw PTY buffer through a minimal virtual terminal emulator.
 *
 * Claude's TUI uses cursor-positioning CSI sequences (CSI n;m H, CSI n C, …)
 * to place text on screen. Naively stripping ANSI codes loses the spacing
 * information encoded in cursor movements, causing words to concatenate.
 * This function simulates a character grid so cursor movements translate
 * into proper whitespace, producing human-readable lines.
 */
function renderBufferLines(buffer: string[]): string[] {
  const raw = buffer.slice(-200).join('')
  const screen: string[][] = [[]]
  let row = 0
  let col = 0
  let i = 0

  while (i < raw.length) {
    const code = raw.charCodeAt(i)

    if (code === 0x0a) {
      row++
      col = 0
      while (screen.length <= row) screen.push([])
      i++
    } else if (code === 0x0d) {
      col = 0
      i++
    } else if (code === 0x07 || code === 0x00) {
      i++
    } else if (code === 0x08) {
      if (col > 0) col--
      i++
    } else if (code === 0x09) {
      col = (Math.floor(col / 8) + 1) * 8
      i++
    } else if (code === 0x1b || code === 0x9b) {
      const isCSI = code === 0x9b
      i++
      if (!isCSI && i < raw.length && raw[i] === '[') {
        i++ // ESC [ → CSI
      } else if (!isCSI && i < raw.length && raw[i] === ']') {
        // OSC — skip until BEL or ST (ESC \)
        i++
        while (i < raw.length) {
          if (raw.charCodeAt(i) === 0x07) {
            i++
            break
          }
          if (raw[i] === '\x1b' && i + 1 < raw.length && raw[i + 1] === '\\') {
            i += 2
            break
          }
          i++
        }
        continue
      } else if (!isCSI && i < raw.length && 'PX^_'.includes(raw[i])) {
        // DCS / SOS / PM / APC — skip until ST
        i++
        while (i < raw.length) {
          if (raw[i] === '\x1b' && i + 1 < raw.length && raw[i + 1] === '\\') {
            i += 2
            break
          }
          i++
        }
        continue
      } else if (!isCSI) {
        if (i < raw.length) i++ // two-byte escape — skip
        continue
      }

      // --- CSI: param bytes (0x30–0x3F) → intermediates (0x20–0x2F) → final (0x40–0x7E) ---
      let params = ''
      while (
        i < raw.length &&
        raw.charCodeAt(i) >= 0x30 &&
        raw.charCodeAt(i) <= 0x3f
      ) {
        params += raw[i]
        i++
      }
      while (
        i < raw.length &&
        raw.charCodeAt(i) >= 0x20 &&
        raw.charCodeAt(i) <= 0x2f
      ) {
        i++
      }
      if (
        i >= raw.length ||
        raw.charCodeAt(i) < 0x40 ||
        raw.charCodeAt(i) > 0x7e
      )
        continue
      const cmd = raw[i]
      i++

      const cleanP = params.replace(/^\?/, '')
      const parts = cleanP
        ? cleanP.split(';').map((p) => Number.parseInt(p, 10) || 0)
        : [0]

      switch (cmd) {
        case 'A':
          row = Math.max(0, row - (parts[0] || 1))
          break
        case 'B':
          row += parts[0] || 1
          break
        case 'C':
          col += parts[0] || 1
          break
        case 'D':
          col = Math.max(0, col - (parts[0] || 1))
          break
        case 'E':
          row += parts[0] || 1
          col = 0
          break
        case 'F':
          row = Math.max(0, row - (parts[0] || 1))
          col = 0
          break
        case 'G':
          col = Math.max(0, (parts[0] || 1) - 1)
          break
        case 'H':
        case 'f':
          row = Math.max(0, (parts[0] || 1) - 1)
          col = Math.max(0, (parts[1] || 1) - 1)
          while (screen.length <= row) screen.push([])
          break
        case 'J': {
          const m = parts[0] || 0
          while (screen.length <= row) screen.push([])
          if (m === 0) {
            screen[row].length = col
            for (let r = row + 1; r < screen.length; r++) screen[r] = []
          } else if (m === 1) {
            for (let r = 0; r < row; r++) screen[r] = []
            for (let c = 0; c <= col && c < screen[row].length; c++)
              screen[row][c] = ' '
          } else {
            for (let r = 0; r < screen.length; r++) screen[r] = []
          }
          break
        }
        case 'K': {
          const m = parts[0] || 0
          while (screen.length <= row) screen.push([])
          const ln = screen[row]
          if (m === 0) ln.length = col
          else if (m === 1) {
            for (let c = 0; c <= col && c < ln.length; c++) ln[c] = ' '
          } else ln.length = 0
          break
        }
        case 'h':
          if (params === '?1049' || params === '?47') {
            screen.length = 0
            screen.push([])
            row = 0
            col = 0
          }
          break
      }
    } else if (code < 0x20) {
      i++
    } else {
      while (screen.length <= row) screen.push([])
      const line = screen[row]
      while (line.length <= col) line.push(' ')
      line[col] = raw[i]
      col++
      i++
    }
  }

  return screen.map((line) => line.join('').trimEnd())
}

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
    // Match lines with a digit followed by dot and text
    // Allow for no space after dot (spaceless terminal output)
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

export interface ParsedPermissionPrompt {
  type: PermissionPromptType
  title: string
  question: string
  context: string
  options: PermissionOption[]
}

/**
 * Scan the PTY buffer for a permission prompt.
 * Returns parsed prompt data or null if no recognized pattern found.
 */
export function scanBufferForPermissionPrompt(
  buffer: string[],
): ParsedPermissionPrompt | null {
  const lines = renderBufferLines(buffer)

  // Try plan mode first
  const planResult = parsePlanMode(lines)
  if (planResult) return planResult

  // Try tool permission
  const toolResult = parseToolPermission(lines)
  if (toolResult) return toolResult

  return null
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

  // Find end marker
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
  // Find the question line using spaceless matching
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

  // Collect option lines after the question
  // Options end at an "Esc to cancel" / "Tab to amend" footer or end of lines
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

  // Walk backwards from question to find title and context
  // Title is the first substantial non-empty line above the question
  // Skip the horizontal rule line (─────)
  let title = ''
  let contextStart = questionIdx
  for (let i = questionIdx - 1; i >= Math.max(0, questionIdx - 15); i--) {
    const line = lines[i]
    if (line.length === 0) continue
    // Skip horizontal rule lines
    if (/^[─━─-]{3,}$/.test(line)) continue

    // This is either context or title — find the title (first line of the block)
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

  // Context is everything between title and question
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
): Promise<void> {
  try {
    const buffer = getSessionBuffer(shellId)
    if (buffer.length === 0) return

    const parsed = scanBufferForPermissionPrompt(buffer)
    if (!parsed) {
      // Debug: dump rendered lines for pattern debugging
      const lines = renderBufferLines(buffer)
      const lastLines = lines.slice(-20).join('\n')
      log.info(`[permission-scanner] parsed=null, last 20 lines:\n${lastLines}`)
      return
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
    if (existing) return

    // Get latest prompt for this session
    const promptId = await getLatestPromptId(sessionId)
    if (!promptId) {
      log.warn(`[permission-scanner] No prompt found for session ${sessionId}`)
      return
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
  } catch (err) {
    log.error(
      { err },
      `[permission-scanner] Failed to scan/store for session=${sessionId}`,
    )
  }
}
