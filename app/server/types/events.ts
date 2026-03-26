import type { CommandEvent } from '@domains/pty/schema'
import type { ServicesStatus } from '@server/types/status'

/**
 * Typed event map for server-side events.
 *
 * Each key is an event name, each value is the tuple of arguments
 * passed to emit() / received by on().
 */
export interface ServerEventMap {
  'db:initialized': []
  'github:refresh-pr-checks': []
  'ngrok:config-changed': []
  'ngrok:url-changed': [tunnelUrl: string]
  'services:status': [status: ServicesStatus]
  'pty:session-created': [payload: { terminalId: number }]
  'pty:session-destroyed': [
    payload: {
      shellId: number
      terminalId: number
      sshHost: string | null
    },
  ]
  'pty:terminal-sessions-destroyed': [
    payload: { terminalId: number; sshHost: string | null },
  ]
  'pty:command-end': [payload: { terminalId: number }]
  'pty:command-event': [
    payload: {
      terminalId: number
      shellId: number
      event: CommandEvent
    },
  ]
}
