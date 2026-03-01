import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as XTerm } from '@xterm/xterm'
import {
  ALargeSmall,
  ChevronDown,
  ChevronUp,
  Info,
  WholeWord,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { DEFAULT_FONT_SIZE } from '../constants'
import { useTerminalContext } from '../context/TerminalContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useSettings } from '../hooks/useSettings'
import { useTerminalSocket } from '../hooks/useTerminalSocket'
import { openInExplorer, openInIDE } from '../lib/api'

interface TerminalProps {
  terminalId: number
  shellId: number
  isVisible: boolean
}

export function Terminal({ terminalId, shellId, isVisible }: TerminalProps) {
  const { terminals } = useTerminalContext()
  const isMobile = useIsMobile()
  const terminal = terminals.find((t) => t.id === terminalId)
  const isCloning = terminal?.git_repo?.status === 'setup'
  const isSettingUp = terminal?.setup?.status === 'setup'
  const isDeleting = terminal?.setup?.status === 'delete'
  const isBusy = isCloning || isSettingUp || isDeleting
  const isBusyRef = useRef(isBusy)
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const [dimensions, setDimensions] = useState({ cols: 80, rows: 24 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{
    index: number
    count: number
  } | null>(null)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [pendingCopy, setPendingCopy] = useState<string | null>(null)
  const pendingCopyRef = useRef<string | null>(null)
  const copyBtnRef = useRef<HTMLButtonElement>(null)
  const cursorRef = useRef({ x: 0, y: 0 })
  const sessionLiveRef = useRef(false)
  const sessionLiveAtRef = useRef(0)
  const isVisibleRef = useRef(isVisible)
  const pendingWritesRef = useRef<string[]>([])
  const { settings } = useSettings()

  const fontSize = settings?.font_size ?? DEFAULT_FONT_SIZE
  const fontSizeRef = useRef(fontSize)
  const settingsRef = useRef(settings)
  const terminalIdRef = useRef(terminalId)
  const cwdRef = useRef(terminal?.cwd)
  const sshHostRef = useRef(terminal?.ssh_host)

  // Keep refs in sync so the link provider closure reads current values
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  useEffect(() => {
    terminalIdRef.current = terminalId
  }, [terminalId])
  useEffect(() => {
    cwdRef.current = terminal?.cwd
  }, [terminal?.cwd])
  useEffect(() => {
    sshHostRef.current = terminal?.ssh_host
  }, [terminal?.ssh_host])

  // Keep fontSizeRef in sync for initialization
  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  // Keep isVisibleRef in sync
  useEffect(() => {
    isVisibleRef.current = isVisible
  }, [isVisible])

  // Keep isBusyRef in sync so the onData closure can read it
  useEffect(() => {
    isBusyRef.current = isBusy
  }, [isBusy])

  const handleData = useCallback((data: string) => {
    if (!isVisibleRef.current) {
      pendingWritesRef.current.push(data)
      return
    }
    terminalRef.current?.write(data)
  }, [])

  const handleExit = useCallback((code: number) => {
    terminalRef.current?.writeln(
      `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`,
    )
  }, [])

  const handleReady = useCallback(() => {
    if (isVisibleRef.current) {
      terminalRef.current?.focus()
    }
    // Defer marking session live until xterm.js has finished processing all
    // queued writes (buffer replay). write('', cb) queues after replay data,
    // so the callback fires only after replay parsing is complete.
    terminalRef.current?.write('', () => {
      sessionLiveRef.current = true
      sessionLiveAtRef.current = Date.now()
    })
  }, [])

  const plusCols = 0
  const { status, sendInput, sendResize } = useTerminalSocket({
    shellId: isCloning ? null : shellId,
    cols: dimensions.cols + plusCols,
    rows: dimensions.rows,
    onData: handleData,
    onExit: handleExit,
    onReady: handleReady,
  })

  // Delay showing status bar to avoid flash on quick connections
  const [showStatus, setShowStatus] = useState(false)
  useEffect(() => {
    if (status === 'connected') {
      setShowStatus(false)
      return
    }
    const timer = setTimeout(() => setShowStatus(true), 500)
    return () => clearTimeout(timer)
  }, [status])

  // Store socket functions in refs to avoid useEffect dependency issues
  const sendInputRef = useRef(sendInput)
  const sendResizeRef = useRef(sendResize)

  useEffect(() => {
    sendInputRef.current = sendInput
    sendResizeRef.current = sendResize
  }, [sendInput, sendResize])

  // Listen for terminal-paste events (e.g. from file picker)
  // Guard with isVisible so only the active shell receives the paste
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number; text: string }>) => {
      if (e.detail.terminalId === terminalId && isVisibleRef.current) {
        sendInputRef.current(e.detail.text)
      }
    }
    window.addEventListener('terminal-paste', handler as EventListener)
    return () =>
      window.removeEventListener('terminal-paste', handler as EventListener)
  }, [terminalId])

  // Listen for terminal-focus events (e.g. from resume session)
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number }>) => {
      if (e.detail.terminalId === terminalId && isVisibleRef.current) {
        terminalRef.current?.focus()
      }
    }
    window.addEventListener('terminal-focus', handler as EventListener)
    return () =>
      window.removeEventListener('terminal-focus', handler as EventListener)
  }, [terminalId])

  // Track cursor position for clipboard copy button (throttled to once per frame)
  useEffect(() => {
    let rafId: number | null = null
    const handler = (e: MouseEvent) => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        cursorRef.current = { x: e.clientX, y: e.clientY }
        if (copyBtnRef.current) {
          copyBtnRef.current.style.left = `${e.clientX}px`
          copyBtnRef.current.style.top = `${e.clientY}px`
        }
        rafId = null
      })
    }
    document.addEventListener('mousemove', handler)
    return () => {
      document.removeEventListener('mousemove', handler)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  // Dismiss clipboard button on Escape (window-level for when terminal loses focus)
  useEffect(() => {
    if (pendingCopy === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pendingCopyRef.current = null
        setPendingCopy(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingCopy])

  const handleCopyClick = useCallback(() => {
    if (pendingCopyRef.current) {
      navigator.clipboard
        .writeText(pendingCopyRef.current)
        .then(() => toast.success('Copied to clipboard'))
        .catch(() => toast.error('Failed to copy to clipboard'))
    }
    pendingCopyRef.current = null
    setPendingCopy(null)
    terminalRef.current?.clearSelection()
  }, [])

  // Initialize xterm.js - only once
  useEffect(() => {
    if (!containerRef.current) return
    if (terminalRef.current) return

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'underline',
      fastScrollSensitivity: 5,
      scrollback: 50000,
      fontSize: fontSizeRef.current,
      macOptionIsMeta: true,
      fontFamily:
        '"MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(webLinksAddon)

    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    searchAddon.onDidChangeResults((e) => {
      setSearchResults({ index: e.resultIndex, count: e.resultCount })
    })

    terminal.open(containerRef.current)

    // Prevent mobile keyboard from appearing
    if (isMobile) {
      const xtermTextarea = containerRef.current.querySelector(
        '.xterm-helper-textarea',
      ) as HTMLTextAreaElement | null
      if (xtermTextarea) {
        xtermTextarea.inputMode = 'none'
      }
    }

    // Accelerate scrolling in alternate screen mode (Zellij, vim, etc.)
    // xterm.js sends one mouse event per wheel tick which feels slow.
    // We send additional mouse/arrow events to boost scroll speed.
    const scrollTarget = containerRef.current.querySelector(
      '.xterm-screen',
    ) as HTMLElement | null
    if (scrollTarget) {
      scrollTarget.addEventListener(
        'wheel',
        (e: WheelEvent) => {
          if (!terminalRef.current) return
          const term = terminalRef.current
          if (term.buffer.active.type !== 'alternate') return
          if (isBusyRef.current) return

          const speed = Math.abs(e.deltaY)
          let extraLines = 0
          if (speed > 250) extraLines = 16
          else if (speed > 150) extraLines = 8
          // console.log('[scroll]', {
          //   deltaY: e.deltaY,
          //   speed,
          //   extraLines,
          //   direction: e.deltaY > 0 ? 'down' : 'up',
          //   mouseTracking: term.modes.mouseTrackingMode,
          // })

          if (extraLines === 0) return

          const down = e.deltaY > 0
          if (term.modes.mouseTrackingMode !== 'none') {
            const btn = down ? 65 : 64
            const rect = scrollTarget.getBoundingClientRect()
            const cellWidth = rect.width / term.cols
            const cellHeight = rect.height / term.rows
            const col = Math.max(
              1,
              Math.min(
                term.cols,
                Math.floor((e.clientX - rect.left) / cellWidth) + 1,
              ),
            )
            const row = Math.max(
              1,
              Math.min(
                term.rows,
                Math.floor((e.clientY - rect.top) / cellHeight) + 1,
              ),
            )
            const seq = `\x1b[<${btn};${col};${row}M`
            for (let i = 0; i < extraLines; i++) {
              sendInputRef.current(seq)
            }
          } else {
            const arrow = down ? '\x1b[B' : '\x1b[A'
            for (let i = 0; i < extraLines; i++) {
              sendInputRef.current(arrow)
            }
          }
        },
        { passive: true },
      )
    }

    // Touch scrolling & long-press selection — xterm.js has no native
    // touch scroll or touch-selection support.  We translate swipe gestures
    // into scrollLines() / arrow-key sequences, and detect a long-press
    // (~400 ms hold without movement) to select the word under the finger.
    // After the long-press fires, subsequent touchmove extends the selection
    // instead of scrolling, and touchend copies the selected text.
    let momentumRafId: number | null = null
    if (scrollTarget) {
      let lastTouchY: number | null = null
      let touchStartX: number | null = null
      let touchStartY: number | null = null
      let touchAccum = 0
      let longPressTimer: ReturnType<typeof setTimeout> | null = null
      let isSelecting = false
      let selectionAnchorCol = 0
      let selectionAnchorRow = 0

      // Inertia / momentum scrolling state
      let lastTouchTime = 0
      let touchVelocity = 0
      const SCROLL_MULTIPLIER = 3.5
      const FRICTION = 0.92
      const MIN_VELOCITY = 0.5 // px/ms threshold to stop momentum

      function getCellFromTouch(touch: Touch, term: XTerm): [number, number] {
        const rect = scrollTarget!.getBoundingClientRect()
        const cellWidth = rect.width / term.cols
        const cellHeight = rect.height / term.rows
        const col = Math.max(
          0,
          Math.min(
            term.cols - 1,
            Math.floor((touch.clientX - rect.left) / cellWidth),
          ),
        )
        const row = Math.max(
          0,
          Math.min(
            term.rows - 1,
            Math.floor((touch.clientY - rect.top) / cellHeight),
          ),
        )
        return [col, row]
      }

      function selectWordAt(
        term: XTerm,
        col: number,
        viewportRow: number,
      ): { start: number; length: number } {
        const bufferRow = viewportRow + term.buffer.active.viewportY
        const line = term.buffer.active.getLine(bufferRow)
        if (!line) {
          term.select(col, bufferRow, 1)
          return { start: col, length: 1 }
        }
        const text = line.translateToString(true)
        const isWord = (c: string) => /\w/.test(c)
        let start = col
        let end = col

        if (col < text.length && isWord(text[col])) {
          while (start > 0 && isWord(text[start - 1])) start--
          while (end < text.length - 1 && isWord(text[end + 1])) end++
        }

        const length = Math.max(1, end - start + 1)
        term.select(start, bufferRow, length)
        return { start, length }
      }

      scrollTarget.addEventListener(
        'touchstart',
        (e: TouchEvent) => {
          if (e.touches.length === 1) {
            const touch = e.touches[0]
            lastTouchY = touch.clientY
            touchStartX = touch.clientX
            touchStartY = touch.clientY
            touchAccum = 0
            isSelecting = false
            touchVelocity = 0
            lastTouchTime = performance.now()

            // Cancel any ongoing momentum animation
            if (momentumRafId !== null) {
              cancelAnimationFrame(momentumRafId)
              momentumRafId = null
            }

            // Clear any existing selection / copy button on new touch
            if (terminalRef.current?.hasSelection()) {
              terminalRef.current.clearSelection()
            }
            if (pendingCopyRef.current) {
              pendingCopyRef.current = null
              setPendingCopy(null)
            }

            // Start long-press timer for text selection
            longPressTimer = setTimeout(() => {
              const term = terminalRef.current
              if (!term) return

              isSelecting = true
              const [col, row] = getCellFromTouch(touch, term)
              const { start } = selectWordAt(term, col, row)
              selectionAnchorCol = start
              selectionAnchorRow = row + term.buffer.active.viewportY

              if (navigator.vibrate) navigator.vibrate(10)
            }, 400)
          }
        },
        { passive: true },
      )

      scrollTarget.addEventListener(
        'touchmove',
        (e: TouchEvent) => {
          if (e.touches.length !== 1 || lastTouchY === null) return
          if (!terminalRef.current) return

          const touch = e.touches[0]

          // If long-press fired → extend selection instead of scrolling
          if (isSelecting) {
            e.preventDefault()
            const term = terminalRef.current
            const [col, viewportRow] = getCellFromTouch(touch, term)
            const bufferRow = viewportRow + term.buffer.active.viewportY

            const anchorOff =
              selectionAnchorRow * term.cols + selectionAnchorCol
            const curOff = bufferRow * term.cols + col

            if (curOff >= anchorOff) {
              term.select(
                selectionAnchorCol,
                selectionAnchorRow,
                curOff - anchorOff + 1,
              )
            } else {
              term.select(col, bufferRow, anchorOff - curOff + 1)
            }
            return
          }

          // Cancel long-press if finger moved >10 px
          if (longPressTimer) {
            const dx = Math.abs(touch.clientX - (touchStartX ?? 0))
            const dy = Math.abs(touch.clientY - (touchStartY ?? 0))
            if (dx > 10 || dy > 10) {
              clearTimeout(longPressTimer)
              longPressTimer = null
            }
          }

          // Prevent Safari pull-to-refresh / page scroll
          e.preventDefault()

          // Cancel any ongoing momentum animation
          if (momentumRafId !== null) {
            cancelAnimationFrame(momentumRafId)
            momentumRafId = null
          }

          const term = terminalRef.current
          const now = performance.now()
          const deltaY = lastTouchY - touch.clientY
          lastTouchY = touch.clientY

          // Track velocity (px/ms) with exponential smoothing
          const dt = now - lastTouchTime
          if (dt > 0) {
            const instantVelocity = deltaY / dt
            touchVelocity = touchVelocity * 0.3 + instantVelocity * 0.7
          }
          lastTouchTime = now

          const cellHeight = scrollTarget!.clientHeight / term.rows || 16
          touchAccum += deltaY * SCROLL_MULTIPLIER

          const lines = Math.trunc(touchAccum / cellHeight)
          if (lines === 0) return
          touchAccum -= lines * cellHeight

          if (term.buffer.active.type === 'alternate') {
            const arrow = lines > 0 ? '\x1b[B' : '\x1b[A'
            const count = Math.abs(lines)
            for (let i = 0; i < count; i++) {
              sendInputRef.current(arrow)
            }
          } else {
            term.scrollLines(lines)
          }
        },
        { passive: false },
      )

      scrollTarget.addEventListener(
        'touchend',
        () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer)
            longPressTimer = null
          }
          lastTouchY = null
          touchStartX = null
          touchStartY = null
          touchAccum = 0

          // Start momentum scrolling if velocity is high enough and not selecting
          const term = terminalRef.current
          if (
            !isSelecting &&
            term &&
            Math.abs(touchVelocity) > MIN_VELOCITY / 1000
          ) {
            const cellHeight = scrollTarget!.clientHeight / term.rows || 16
            let velocity = touchVelocity * SCROLL_MULTIPLIER // px/ms
            let accumPx = 0
            let lastFrame = performance.now()

            const momentumStep = () => {
              const now = performance.now()
              const dt = now - lastFrame
              lastFrame = now

              velocity *= FRICTION
              accumPx += velocity * dt

              const lines = Math.trunc(accumPx / cellHeight)
              if (lines !== 0) {
                accumPx -= lines * cellHeight
                if (term.buffer.active.type === 'alternate') {
                  const arrow = lines > 0 ? '\x1b[B' : '\x1b[A'
                  const count = Math.abs(lines)
                  for (let i = 0; i < count; i++) {
                    sendInputRef.current(arrow)
                  }
                } else {
                  term.scrollLines(lines)
                }
              }

              if (Math.abs(velocity * 1000) > MIN_VELOCITY) {
                momentumRafId = requestAnimationFrame(momentumStep)
              } else {
                momentumRafId = null
              }
            }
            momentumRafId = requestAnimationFrame(momentumStep)
          }

          // Show copy button so the user can tap it (a clear user gesture
          // that iOS trusts for clipboard access).
          if (isSelecting && terminalRef.current?.hasSelection()) {
            const text = terminalRef.current.getSelection()
            if (text) {
              pendingCopyRef.current = text
              setPendingCopy(text)
            }
          }

          isSelecting = false
        },
        { passive: true },
      )
    }

    // File path link provider — detect file paths in terminal output and open in IDE on click
    const filePathRegex =
      /(?:^|[\s'"`({[:])([~.]?\/[\w./@-]+(?:\/[\w./@-]+)*\.\w+(?::\d+(?::\d+)?)?|(?:[\w.@-]+\/)+[\w.@-]+\.\w+(?::\d+(?::\d+)?)?)/g
    terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        // File path links only work for local terminals
        if (sshHostRef.current) return callback(undefined)

        const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) return callback(undefined)

        const text = line.translateToString(true)
        const links: import('@xterm/xterm').ILink[] = []

        for (const match of text.matchAll(filePathRegex)) {
          const filePath = match[1]
          if (!filePath) continue

          // Find position in the line — account for leading separator captured by the group boundary
          const matchStart = match.index + (match[0].length - filePath.length)

          // Skip if preceded by :// (part of a URL)
          const before = text.slice(0, matchStart)
          if (before.endsWith('://') || before.endsWith(':/')) continue

          links.push({
            range: {
              start: { x: matchStart + 1, y: bufferLineNumber },
              end: {
                x: matchStart + filePath.length + 1,
                y: bufferLineNumber,
              },
            },
            text: filePath,
            activate: (event, linkText) => {
              if (event instanceof MouseEvent && event.metaKey) {
                openInExplorer(linkText, terminalIdRef.current).catch((err) => {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : 'Failed to open in Finder',
                  )
                })
              } else {
                const ide = settingsRef.current?.preferred_ide ?? 'cursor'
                openInIDE(linkText, ide, terminalIdRef.current).catch((err) => {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : 'Failed to open in IDE',
                  )
                })
              }
            },
          })
        }

        callback(links.length > 0 ? links : undefined)
      },
    })

    // OSC 52 clipboard handler — intercept copy sequences from programs like zellij
    // Skip during buffer replay (before 'ready' message) to avoid stale clipboard popups
    terminal.parser.registerOscHandler(52, (data: string) => {
      if (!sessionLiveRef.current) return true
      const idx = data.indexOf(';')
      if (idx === -1) return false
      const payload = data.slice(idx + 1)
      if (!payload || payload === '?') return true
      try {
        const decoded = atob(payload)
        const text = new TextDecoder().decode(
          Uint8Array.from(decoded, (c) => c.charCodeAt(0)),
        )
        if (text.length > 1_000_000) return true
        navigator.clipboard.writeText(text).catch(() => {
          // Clipboard API failed (e.g. not focused), fall back to button
          pendingCopyRef.current = text
          setPendingCopy(text)
        })
      } catch {
        // invalid base64
      }
      return true
    })

    // Escape dismisses copy button when terminal is focused (prevents sending \x1b to PTY)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      if (event.key === 'Escape' && pendingCopyRef.current !== null) {
        pendingCopyRef.current = null
        setPendingCopy(null)
        return false
      }

      // Cmd+F to open search
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return false
      }

      // Block all input during setup/teardown
      if (isBusyRef.current) return false

      // Shift+Enter → send kitty keyboard protocol sequence so CLI apps
      // (e.g. Claude Code) can distinguish it from plain Enter and insert a newline.
      if (event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        sendInputRef.current('\x1b[13;2u')
        return false
      }

      // Option+Arrow word jumping (macOS) — send Meta-b / Meta-f / ESC-backspace
      if (event.altKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          sendInputRef.current('\x1bb')
          return false
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          sendInputRef.current('\x1bf')
          return false
        }
        if (event.key === 'Backspace') {
          event.preventDefault()
          sendInputRef.current('\x1b\x7f')
          return false
        }
      }

      return true
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit()
      // Add extra row and column for better coverage
      const cols = terminal.cols + plusCols
      const rows = terminal.rows
      terminal.resize(cols, rows)
      setDimensions({ cols, rows })
    })

    // Handle input - use ref to avoid stale closure
    terminal.onData((data) => {
      if (isBusyRef.current) return
      sendInputRef.current(data)
      // xterm captures keydown events internally so they don't bubble to window.
      // Dispatch a custom event so the user-activity tracker in App.tsx picks it up.
      if (!isMobile) {
        window.dispatchEvent(new Event('terminal-activity'))
      }
    })

    // Handle resize (debounced via rAF to avoid hammering during drag/layout)
    let resizeRafId: number | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          // Add extra row and column for better coverage
          const cols = terminalRef.current.cols + plusCols
          const rows = terminalRef.current.rows
          terminalRef.current.resize(cols, rows)
          setDimensions({ cols, rows })
          sendResizeRef.current(cols, rows)
        }
      })
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
      if (momentumRafId !== null) cancelAnimationFrame(momentumRafId)
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, []) // No dependencies - initialize once

  // Load WebGL addon only for visible terminals, dispose when hidden
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    if (!isVisible) return
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      terminal.loadAddon(webglAddon)
    } catch {
      // WebGL not available, canvas renderer will be used
    }
    return () => {
      webglAddon?.dispose()
    }
  }, [isVisible])

  // Re-fit, flush buffered data, and focus when becoming visible
  useEffect(() => {
    if (isVisible && terminalRef.current && fitAddonRef.current) {
      // Flush data that arrived while hidden
      if (pendingWritesRef.current.length > 0) {
        const pending = pendingWritesRef.current.join('')
        pendingWritesRef.current = []
        terminalRef.current.write(pending)
      }
      fitAddonRef.current.fit()
      const cols = terminalRef.current.cols + plusCols
      const rows = terminalRef.current.rows
      terminalRef.current.resize(cols, rows)
      setDimensions({ cols, rows })
      sendResizeRef.current(cols, rows)
      terminalRef.current.focus()
    }
  }, [isVisible])

  // Update font size when settings change
  useEffect(() => {
    if (terminalRef.current && fitAddonRef.current) {
      terminalRef.current.options.fontSize = fontSize
      fitAddonRef.current.fit()
      const { cols, rows } = terminalRef.current
      setDimensions({ cols, rows })
      sendResizeRef.current(cols, rows)
    }
  }, [fontSize])

  // Search options with decorations enabled (required for onDidChangeResults)
  const searchOptions = useMemo(
    () => ({
      caseSensitive,
      wholeWord,
      decorations: {
        matchBackground: '#b5890090',
        matchBorder: '#b58900',
        matchOverviewRuler: '#b58900',
        activeMatchBackground: '#dc322f',
        activeMatchBorder: '#dc322f',
        activeMatchColorOverviewRuler: '#dc322f',
      },
    }),
    [caseSensitive, wholeWord],
  )

  // Search functions
  const handleSearch = useCallback(
    (query: string, direction: 'next' | 'prev') => {
      if (!searchAddonRef.current || !query) return
      if (direction === 'next') {
        searchAddonRef.current.findNext(query, searchOptions)
      } else {
        searchAddonRef.current.findPrevious(query, searchOptions)
      }
    },
    [searchOptions],
  )

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults(null)
    setCaseSensitive(false)
    setWholeWord(false)
    searchAddonRef.current?.clearDecorations()
    terminalRef.current?.focus()
  }, [])

  // Re-search when options change
  useEffect(() => {
    if (searchOpen && searchQuery && searchAddonRef.current) {
      searchAddonRef.current.findNext(searchQuery, searchOptions)
    }
  }, [searchOpen, searchQuery, searchOptions])

  // Handle search input keydown
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSearch()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
      } else if (e.altKey && e.code === 'KeyC') {
        e.preventDefault()
        setCaseSensitive((v) => !v)
      } else if (e.altKey && e.code === 'KeyW') {
        e.preventDefault()
        setWholeWord((v) => !v)
      }
    },
    [closeSearch, handleSearch, searchQuery],
  )

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col bg-[#1a1a1a]',
        !isVisible && 'invisible',
      )}
    >
      {showStatus && status !== 'connected' && status !== 'already_open' && (
        <div className="px-3 py-1 text-xs bg-yellow-900/50 text-yellow-200 flex items-center gap-2">
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              status === 'connecting'
                ? 'bg-yellow-400 animate-pulse'
                : status === 'error'
                  ? 'bg-red-400'
                  : 'bg-gray-400',
            )}
          />
          {status === 'connecting' && 'Connecting...'}
          {status === 'disconnected' && 'Disconnected - Reconnecting...'}
          {status === 'error' && 'Connection error'}
        </div>
      )}
      {status === 'already_open' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1a1a1a]">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <Info className="w-8 h-8 text-zinc-500" />
            <p className="text-sm">This shell is already open on your device</p>
          </div>
        </div>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={containerRef} className="h-full" />
        {searchOpen && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg p-1 z-10"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (e.target.value) {
                  searchAddonRef.current?.findNext(
                    e.target.value,
                    searchOptions,
                  )
                } else {
                  setSearchResults(null)
                  searchAddonRef.current?.clearDecorations()
                }
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              className="w-48 px-2 py-1 text-sm bg-transparent text-white placeholder-zinc-500 outline-none"
            />
            {searchResults && searchQuery && (
              <span className="text-xs text-zinc-400 px-1 whitespace-nowrap">
                {searchResults.count === 0
                  ? 'No results'
                  : `${searchResults.index + 1}/${searchResults.count}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setCaseSensitive((v) => !v)
                searchInputRef.current?.focus()
              }}
              className={cn(
                'p-1 rounded',
                caseSensitive
                  ? 'bg-zinc-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-700',
              )}
              title="Case Sensitive (⌥C)"
            >
              <ALargeSmall className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setWholeWord((v) => !v)
                searchInputRef.current?.focus()
              }}
              className={cn(
                'p-1 rounded',
                wholeWord
                  ? 'bg-zinc-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-700',
              )}
              title="Whole Word (⌥W)"
            >
              <WholeWord className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                handleSearch(searchQuery, 'prev')
                searchInputRef.current?.focus()
              }}
              className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
              title="Previous (Shift+Enter)"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                handleSearch(searchQuery, 'next')
                searchInputRef.current?.focus()
              }}
              className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
              title="Next (Enter)"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={closeSearch}
              className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      {pendingCopy !== null && (
        <button
          type="button"
          onClick={handleCopyClick}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] px-4 py-2 bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-lg select-none"
        >
          Copy
        </button>
      )}
    </div>
  )
}
