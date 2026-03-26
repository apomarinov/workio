/**
 * Render raw PTY buffer through a minimal virtual terminal emulator.
 *
 * Claude's TUI uses cursor-positioning CSI sequences (CSI n;m H, CSI n C, …)
 * to place text on screen. Naively stripping ANSI codes loses the spacing
 * information encoded in cursor movements, causing words to concatenate.
 * This function simulates a character grid so cursor movements translate
 * into proper whitespace, producing human-readable lines.
 */
export function renderBufferLines(buffer: string[]) {
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
