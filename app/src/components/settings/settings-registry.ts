/**
 * Settings registry — defines the structure, metadata, and search keywords
 * for every setting rendered in the settings view. No values here, just
 * the shape used to render controls and power search.
 */

import { Github, Globe, Keyboard, Monitor, Settings } from 'lucide-react'
import { ClaudeIcon } from '@/components/icons'

// --- Control types ---

type ControlToggle = { control: 'toggle' }
type ControlNumber = { control: 'number'; min?: number; max?: number }
type ControlText = { control: 'text'; placeholder?: string }
type ControlSecret = { control: 'secret'; placeholder?: string }
type ControlSelect = {
  control: 'select'
  options: { value: string; label: string }[]
}
type ControlTagList = { control: 'tag-list' }
type ControlPRList = { control: 'pr-list' }
type ControlOrderedList = { control: 'ordered-list' }
type ControlMobileKeyboard = { control: 'mobile-keyboard' }
type ControlShellTemplates = { control: 'shell-templates' }
type ControlCustomActions = { control: 'custom-actions' }
type ControlStatusBar = { control: 'status-bar' }
type ControlKeymap = { control: 'keymap' }

type SettingControl =
  | ControlToggle
  | ControlNumber
  | ControlText
  | ControlSecret
  | ControlSelect
  | ControlTagList
  | ControlPRList
  | ControlOrderedList
  | ControlMobileKeyboard
  | ControlShellTemplates
  | ControlCustomActions
  | ControlStatusBar
  | ControlKeymap

// --- Setting definition ---

export interface SettingDef {
  /** Dot-path key into the settings object, e.g. 'server_config.session_timeout_ms' */
  key: string
  label: string
  description: string
  keywords: string[]
  /** Which control to render */
  type: SettingControl
}

type IconComponent = React.ComponentType<{ className?: string }>

export interface SettingsSection {
  name: string
  icon?: IconComponent
  settings?: SettingDef[]
  children?: SettingsSection[]
}

// --- Registry ---

export const SETTINGS_REGISTRY: SettingsSection[] = [
  // ─── General ──────────────────────────────────────────
  {
    name: 'General',
    icon: Settings,
    children: [
      {
        name: 'Application',
        settings: [
          {
            key: 'preferred_ide',
            label: 'Preferred IDE',
            description: 'Which IDE to launch when opening files',
            keywords: ['editor', 'cursor', 'vscode', 'open', 'launch'],
            type: {
              control: 'select',
              options: [
                { value: 'cursor', label: 'Cursor' },
                { value: 'vscode', label: 'VS Code' },
              ],
            },
          },
        ],
      },
      {
        name: 'Notifications',
        settings: [
          {
            key: 'server_config.notification_active_timeout',
            label: 'Desktop Active Timeout',
            description:
              'How long after last activity to suppress push notifications',
            keywords: ['push', 'notification', 'timeout', 'active', 'desktop'],
            type: { control: 'number', min: 1000 },
          },
        ],
      },
      {
        name: 'Security',
        settings: [
          {
            key: 'server_config.auth_max_failures',
            label: 'Max Login Failures',
            description: 'Failed login attempts before lockout',
            keywords: ['auth', 'login', 'password', 'lockout', 'security'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'server_config.auth_lockout_ms',
            label: 'Lockout Duration',
            description: 'How long an IP stays locked out',
            keywords: ['auth', 'lockout', 'ban', 'duration', 'security'],
            type: { control: 'number', min: 60_000 },
          },
        ],
      },
    ],
  },

  // ─── Terminal ─────────────────────────────────────────
  {
    name: 'Terminal',
    icon: Monitor,
    children: [
      {
        name: 'Shell',
        settings: [
          {
            key: 'default_shell',
            label: 'Default Shell',
            description: 'Shell used when creating new terminals',
            keywords: ['bash', 'zsh', 'fish', 'shell', 'path'],
            type: { control: 'text', placeholder: '/bin/bash' },
          },
          {
            key: 'shell_templates',
            label: 'Shell Templates',
            description: 'Reusable shell command templates',
            keywords: ['template', 'command', 'preset', 'layout'],
            type: { control: 'shell-templates' },
          },
          {
            key: 'custom_terminal_actions',
            label: 'Custom Actions',
            description: 'Custom terminal context menu actions',
            keywords: ['action', 'command', 'custom', 'menu'],
            type: { control: 'custom-actions' },
          },
        ],
      },
      {
        name: 'Display',
        settings: [
          {
            key: 'font_size',
            label: 'Font Size',
            description: 'Terminal font size (desktop)',
            keywords: ['font', 'text', 'size', 'zoom', 'terminal'],
            type: { control: 'number', min: 8, max: 32 },
          },
          {
            key: 'mobile_font_size',
            label: 'Mobile Font Size',
            description: 'Terminal font size (mobile)',
            keywords: ['font', 'text', 'size', 'zoom', 'mobile'],
            type: { control: 'number', min: 8, max: 32 },
          },
          {
            key: 'statusBar',
            label: 'Status Bar',
            description:
              'Configure status bar visibility, position, and sections',
            keywords: ['status', 'bar', 'bottom', 'top', 'sections', 'order'],
            type: { control: 'status-bar' },
          },
        ],
      },
      {
        name: 'Scrollback',
        settings: [
          {
            key: 'server_config.max_buffer_lines',
            label: 'Scrollback Lines (Server)',
            description: 'Lines retained in the server-side output buffer',
            keywords: ['buffer', 'scroll', 'history', 'lines', 'server'],
            type: { control: 'number', min: 500 },
          },
        ],
      },
      {
        name: 'Session',
        settings: [
          {
            key: 'server_config.session_timeout_ms',
            label: 'Idle Timeout',
            description: 'Destroy terminal session after this idle period',
            keywords: ['idle', 'timeout', 'session', 'destroy', 'inactive'],
            type: { control: 'number', min: 60_000 },
          },
        ],
      },
      {
        name: 'Mobile Keyboard',
        settings: [
          {
            key: 'mobile_keyboard_rows',
            label: 'Keyboard Rows',
            description: 'Customize mobile keyboard action rows',
            keywords: [
              'mobile',
              'keyboard',
              'keys',
              'rows',
              'actions',
              'touch',
            ],
            type: { control: 'mobile-keyboard' },
          },
        ],
      },
    ],
  },

  // ─── Claude ───────────────────────────────────────────
  {
    name: 'Claude',
    icon: ClaudeIcon,
    children: [
      {
        name: 'Display',
        settings: [
          {
            key: 'show_thinking',
            label: 'Show Thinking',
            description: "Display Claude's extended thinking output",
            keywords: ['thinking', 'reasoning', 'claude', 'ai'],
            type: { control: 'toggle' },
          },
          {
            key: 'show_tools',
            label: 'Show Tool Calls',
            description: 'Display tool call blocks in conversations',
            keywords: ['tools', 'function', 'calls', 'claude', 'ai'],
            type: { control: 'toggle' },
          },
          {
            key: 'show_tool_output',
            label: 'Show Tool Output',
            description:
              'Display tool call results (only when Show Tool Calls is on)',
            keywords: ['tools', 'output', 'results', 'claude', 'ai'],
            type: { control: 'toggle' },
          },
          {
            key: 'message_line_clamp',
            label: 'Message Line Clamp',
            description: 'Max preview lines shown for messages in session list',
            keywords: ['message', 'preview', 'lines', 'clamp', 'truncate'],
            type: { control: 'number', min: 1, max: 20 },
          },
        ],
      },
      {
        name: 'Sessions',
        settings: [
          {
            key: 'ignore_external_sessions',
            label: 'Ignore External Sessions',
            description: 'Skip sessions launched outside WorkIO',
            keywords: ['external', 'sessions', 'ignore', 'filter', 'claude'],
            type: { control: 'toggle' },
          },
        ],
      },
    ],
  },

  // ─── Keymap ───────────────────────────────────────────
  {
    name: 'Keymap',
    icon: Keyboard,
    settings: [
      {
        key: 'keymap',
        label: 'Keyboard Shortcuts',
        description: 'Customize keyboard shortcuts for all actions',
        keywords: [
          'keyboard',
          'shortcut',
          'keybinding',
          'hotkey',
          'palette',
          'tab',
          'shell',
          'sidebar',
          'commit',
        ],
        type: { control: 'keymap' },
      },
    ],
  },

  // ─── GitHub ───────────────────────────────────────────
  {
    name: 'GitHub',
    icon: Github,
    children: [
      {
        name: 'PR Data',
        settings: [
          {
            key: 'server_config.gh_poll_interval',
            label: 'Check Poll Interval',
            description: 'How often to poll GitHub for PR check status',
            keywords: ['poll', 'interval', 'github', 'pr', 'refresh', 'checks'],
            type: { control: 'number', min: 10_000 },
          },
        ],
      },
      {
        name: 'Query Limits',
        settings: [
          {
            key: 'gh_query_limits.checks',
            label: 'Checks',
            description: 'Max check runs to fetch per PR',
            keywords: ['checks', 'github', 'limit', 'query'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'gh_query_limits.reviews',
            label: 'Reviews',
            description: 'Max reviews to fetch per PR',
            keywords: ['reviews', 'github', 'limit', 'query'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'gh_query_limits.comments',
            label: 'Comments',
            description: 'Max comments to fetch per PR',
            keywords: ['comments', 'github', 'limit', 'query'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'gh_query_limits.review_threads',
            label: 'Review Threads',
            description: 'Max review threads to fetch',
            keywords: ['threads', 'github', 'limit', 'query', 'review'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'gh_query_limits.thread_comments',
            label: 'Thread Comments',
            description: 'Max comments per review thread',
            keywords: ['thread', 'comments', 'github', 'limit', 'query'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'gh_query_limits.review_requests',
            label: 'Review Requests',
            description: 'Max review requests to fetch',
            keywords: ['review', 'requests', 'github', 'limit', 'query'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'gh_query_limits.reactors',
            label: 'Reactors',
            description: 'Max reactors to show per reaction',
            keywords: ['reactors', 'reactions', 'github', 'limit', 'emoji'],
            type: { control: 'number', min: 1 },
          },
        ],
      },
      {
        name: 'Author Filters',
        settings: [
          {
            key: 'hide_gh_authors',
            label: 'Hidden Authors',
            description: 'Hide all PRs from these authors',
            keywords: ['hide', 'author', 'filter', 'github', 'pr'],
            type: { control: 'tag-list' },
          },
          {
            key: 'silence_gh_authors',
            label: 'Silenced Authors',
            description: 'Suppress notifications but show PRs',
            keywords: [
              'silence',
              'mute',
              'author',
              'filter',
              'github',
              'notification',
            ],
            type: { control: 'tag-list' },
          },
          {
            key: 'collapse_gh_authors',
            label: 'Collapsed Authors',
            description: 'Collapse PRs from these authors by default',
            keywords: ['collapse', 'author', 'filter', 'github', 'fold'],
            type: { control: 'tag-list' },
          },
          {
            key: 'hidden_prs',
            label: 'Hidden PRs',
            description: 'Individually hidden pull requests',
            keywords: ['hide', 'pr', 'pull request', 'github', 'filter'],
            type: { control: 'pr-list' },
          },
        ],
      },
    ],
  },

  // ─── Remote Access ────────────────────────────────────
  {
    name: 'Remote Access',
    icon: Globe,
    children: [
      {
        name: 'ngrok',
        settings: [
          {
            key: 'ngrok.domain',
            label: 'Domain',
            description: 'ngrok domain for remote access',
            keywords: ['ngrok', 'domain', 'tunnel', 'remote', 'url'],
            type: {
              control: 'text',
              placeholder: 'your-domain.ngrok-free.app',
            },
          },
          {
            key: 'ngrok.token',
            label: 'Auth Token',
            description: 'ngrok authentication token',
            keywords: ['ngrok', 'token', 'auth', 'key', 'remote'],
            type: { control: 'secret', placeholder: 'ngrok auth token' },
          },
        ],
      },
      {
        name: 'SSH',
        settings: [
          {
            key: 'server_config.ssh_max_channels',
            label: 'Max SSH Channels',
            description: 'Max concurrent SSH exec channels per connection',
            keywords: ['ssh', 'channels', 'concurrent', 'remote'],
            type: { control: 'number', min: 1 },
          },
          {
            key: 'server_config.ssh_idle_timeout',
            label: 'SSH Idle Timeout',
            description: 'Close idle SSH connection after this period',
            keywords: ['ssh', 'idle', 'timeout', 'remote', 'disconnect'],
            type: { control: 'number', min: 60_000 },
          },
          {
            key: 'server_config.ssh_default_timeout',
            label: 'SSH Command Timeout',
            description: 'Default timeout for SSH commands',
            keywords: ['ssh', 'command', 'timeout', 'remote'],
            type: { control: 'number', min: 1000 },
          },
          {
            key: 'server_config.ssh_keepalive_interval',
            label: 'SSH Keepalive Interval',
            description: 'SSH keepalive ping interval',
            keywords: ['ssh', 'keepalive', 'ping', 'heartbeat', 'remote'],
            type: { control: 'number', min: 1000 },
          },
        ],
      },
    ],
  },
]

// --- Search helpers ---

/** Flat list of all settings with their full ancestor path for search */
export type FlatSetting = SettingDef & {
  /** Ancestor section names, e.g. ['General', 'Notifications'] */
  ancestors: string[]
  /** Display path, e.g. 'General > Notifications > Desktop Active Timeout' */
  path: string
}

export function flattenSettings(
  sections: SettingsSection[] = SETTINGS_REGISTRY,
  ancestors: string[] = [],
): FlatSetting[] {
  const result: FlatSetting[] = []
  for (const section of sections) {
    const path = [...ancestors, section.name]
    if (section.settings) {
      for (const setting of section.settings) {
        result.push({
          ...setting,
          ancestors: path,
          path: [...path, setting.label].join(' > '),
        })
      }
    }
    if (section.children) {
      result.push(...flattenSettings(section.children, path))
    }
  }
  return result
}

/** Search settings by query string, matching against label, description, ancestors, and keywords */
export function searchSettings(query: string): FlatSetting[] {
  if (!query.trim()) return flattenSettings()
  const terms = query.toLowerCase().split(/\s+/)
  return flattenSettings().filter((s) => {
    const haystack = [s.label, s.description, ...s.ancestors, ...s.keywords]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
