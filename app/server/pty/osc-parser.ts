// OSC 133 Shell Integration Parser
// Parses OSC escape sequences from terminal output to extract command events

export interface CommandEvent {
  type: 'prompt' | 'command_start' | 'command_end'
  command?: string // For command_start
  exitCode?: number // For command_end
}

export type CommandEventCallback = (event: CommandEvent) => void

// Character codes
const ESC = '\x1b'
const BEL = '\x07'
const ST = '\x1b\\' // String Terminator

/**
 * Creates an OSC parser that wraps a data callback.
 * It intercepts OSC 133 sequences and emits command events,
 * while passing through all other data (including the OSC sequences themselves).
 */
export function createOscParser(
  onData: (data: string) => void,
  onCommandEvent: CommandEventCallback,
): (data: string) => void {
  // Buffer for incomplete escape sequences
  let buffer = ''

  // OSC 133 format: ESC ] 133 ; <type> [; <data>] ESC \
  // Or: ESC ] 133 ; <type> [; <data>] BEL
  // Types:
  //   A - Prompt start (shell idle)
  //   C - Command start (includes command text)
  //   D - Command end (includes exit code)

  return (data: string) => {
    // Combine with any buffered data
    const combined = buffer + data
    buffer = ''

    // Check if we might have an incomplete OSC 133 sequence at the end
    // Only buffer if it looks like the start of OSC 133
    const osc133Start = combined.lastIndexOf(`${ESC}]133`)
    if (osc133Start !== -1 && osc133Start > combined.length - 50) {
      const tail = combined.slice(osc133Start)
      // Only buffer if we don't have a terminator yet
      if (!tail.includes(BEL) && !tail.includes(ST)) {
        buffer = tail
        const toProcess = combined.slice(0, osc133Start)
        if (toProcess) {
          processData(toProcess)
        }
        return
      }
    }

    processData(combined)
  }

  function processData(data: string) {
    // Find and process all OSC 133 sequences manually
    let pos = 0

    while (pos < data.length) {
      // Look for ESC ] 133 ;
      const escPos = data.indexOf(`${ESC}]133;`, pos)
      if (escPos === -1) break

      // Find the type character (A, C, or D)
      // ESC]133; = 6 characters (ESC is 1 char)
      const typePos = escPos + 6
      if (typePos >= data.length) break

      const typeChar = data[typePos]
      if (typeChar !== 'A' && typeChar !== 'C' && typeChar !== 'D') {
        pos = escPos + 1
        continue
      }

      // Find terminator (BEL or ST)
      let endPos = -1
      let payload = ''

      // Check for semicolon (payload follows)
      const afterType = typePos + 1
      if (afterType < data.length && data[afterType] === ';') {
        // Has payload - find terminator
        const belPos = data.indexOf(BEL, afterType)
        const stPos = data.indexOf(ST, afterType)

        if (belPos !== -1 && (stPos === -1 || belPos < stPos)) {
          endPos = belPos + 1
          payload = data.slice(afterType + 1, belPos)
        } else if (stPos !== -1) {
          endPos = stPos + 2
          payload = data.slice(afterType + 1, stPos)
        }
      } else {
        // No payload - find terminator immediately after type
        const belPos = data.indexOf(BEL, afterType)
        const stPos = data.indexOf(ST, afterType)

        if (belPos !== -1 && belPos === afterType) {
          endPos = belPos + 1
        } else if (stPos !== -1 && stPos === afterType) {
          endPos = stPos + 2
        } else if (belPos !== -1 && (stPos === -1 || belPos < stPos)) {
          endPos = belPos + 1
          payload = data.slice(afterType, belPos)
        } else if (stPos !== -1) {
          endPos = stPos + 2
          payload = data.slice(afterType, stPos)
        }
      }

      if (endPos === -1) {
        pos = escPos + 1
        continue
      }

      // Emit the appropriate event (skip empty commands)
      switch (typeChar) {
        case 'A':
          onCommandEvent({ type: 'prompt' })
          break
        case 'C':
          if (payload) {
            onCommandEvent({ type: 'command_start', command: payload })
          }
          break
        case 'D':
          onCommandEvent({
            type: 'command_end',
            exitCode: payload ? Number.parseInt(payload, 10) : 0,
          })
          break
      }

      pos = endPos
    }

    // Pass through all data (including OSC sequences - xterm.js handles them fine)
    onData(data)
  }
}
