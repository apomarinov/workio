import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as XTerm } from '@xterm/xterm'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_FONT_SIZE } from '../constants'
import { useSettings } from '../hooks/useSettings'
import { useTerminalSocket } from '../hooks/useTerminalSocket'

interface TerminalProps {
  terminalId: number | null
}

export function Terminal({ terminalId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [dimensions, setDimensions] = useState({ cols: 80, rows: 24 })
  const { settings } = useSettings()

  const fontSize = settings?.font_size ?? DEFAULT_FONT_SIZE
  const fontSizeRef = useRef(fontSize)

  // Keep fontSizeRef in sync for initialization
  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  const handleData = useCallback((data: string) => {
    terminalRef.current?.write(data)
  }, [])

  const handleExit = useCallback((code: number) => {
    terminalRef.current?.writeln(
      `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`,
    )
  }, [])

  const handleReady = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  const { status, sendInput, sendResize } = useTerminalSocket({
    terminalId,
    cols: dimensions.cols,
    rows: dimensions.rows,
    onData: handleData,
    onExit: handleExit,
    onReady: handleReady,
  })

  // Store socket functions in refs to avoid useEffect dependency issues
  const sendInputRef = useRef(sendInput)
  const sendResizeRef = useRef(sendResize)

  useEffect(() => {
    sendInputRef.current = sendInput
    sendResizeRef.current = sendResize
  }, [sendInput, sendResize])

  // Initialize xterm.js - only once
  useEffect(() => {
    if (!containerRef.current) return
    if (terminalRef.current) return

    const terminal = new XTerm({
      cursorBlink: true,
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

    terminal.open(containerRef.current)

    // Try to load WebGL addon for better performance
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      terminal.loadAddon(webglAddon)
    } catch {
      // WebGL not available, canvas renderer will be used
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit()
      // Add extra row and column for better coverage
      const cols = terminal.cols
      const rows = terminal.rows
      terminal.resize(cols, rows)
      setDimensions({ cols, rows })
    })

    // Handle input - use ref to avoid stale closure
    terminal.onData((data) => {
      sendInputRef.current(data)
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
        // Add extra row and column for better coverage
        const cols = terminalRef.current.cols
        const rows = terminalRef.current.rows
        terminalRef.current.resize(cols, rows)
        setDimensions({ cols, rows })
        sendResizeRef.current(cols, rows)
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, []) // No dependencies - initialize once

  // Clear terminal when terminalId changes
  useEffect(() => {
    if (terminalRef.current && terminalId !== null) {
      terminalRef.current.clear()
    }
  }, [terminalId])

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

  return (
    <div className="flex-1 flex flex-col bg-[#1a1a1a]">
      {terminalId === null ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          Select a terminal from the sidebar
        </div>
      ) : (
        status !== 'connected' && (
          <div className="px-3 py-1 text-xs bg-yellow-900/50 text-yellow-200 flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'connecting'
                  ? 'bg-yellow-400 animate-pulse'
                  : status === 'error'
                    ? 'bg-red-400'
                    : 'bg-gray-400'
              }`}
            />
            {status === 'connecting' && 'Connecting...'}
            {status === 'disconnected' && 'Disconnected - Reconnecting...'}
            {status === 'error' && 'Connection error'}
          </div>
        )
      )}
      <div
        ref={containerRef}
        className={`flex-1 min-h-0 overflow-hidden ${terminalId === null ? 'hidden' : ''}`}
      />
    </div>
  )
}
