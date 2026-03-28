/**
 * Settings registry — defines the structure, metadata, and search keywords
 * for every setting rendered in the settings view. Each setting points to
 * a component that owns its own rendering, validation, and persistence.
 */

import { Github, Globe, Keyboard, Monitor, Settings } from 'lucide-react'
import { ClaudeIcon } from '@/components/icons'
import { Placeholder } from './controls/Placeholder'

// --- Setting definition ---

type IconComponent = React.ComponentType<{ className?: string }>

export interface SettingDef {
  /** Unique key for this setting, used for search result identity */
  key: string
  label: string
  description: string
  keywords: string[]
  /** Component that renders the control for this setting */
  component: React.ComponentType
}

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
            component: Placeholder,
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
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'server_config.auth_lockout_ms',
            label: 'Lockout Duration',
            description: 'How long an IP stays locked out',
            keywords: ['auth', 'lockout', 'ban', 'duration', 'security'],
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'shell_templates',
            label: 'Shell Templates',
            description: 'Reusable shell command templates',
            keywords: ['template', 'command', 'preset', 'layout'],
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'mobile_font_size',
            label: 'Mobile Font Size',
            description: 'Terminal font size (mobile)',
            keywords: ['font', 'text', 'size', 'zoom', 'mobile'],
            component: Placeholder,
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
            component: Placeholder,
          },
        ],
      },
      {
        name: 'PTY',
        settings: [
          {
            key: 'server_config.session_timeout_ms',
            label: 'Idle Timeout',
            description: 'Destroy terminal pty after this idle period',
            keywords: ['idle', 'timeout', 'pty', 'destroy', 'inactive'],
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'custom_terminal_actions',
            label: 'Custom Actions',
            description: 'Custom terminal context menu actions',
            keywords: ['action', 'command', 'custom', 'menu'],
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'show_tools',
            label: 'Show Tool Calls',
            description: 'Display tool call blocks in conversations',
            keywords: ['tools', 'function', 'calls', 'claude', 'ai'],
            component: Placeholder,
          },
          {
            key: 'show_tool_output',
            label: 'Show Tool Output',
            description:
              'Display tool call results (only when Show Tool Calls is on)',
            keywords: ['tools', 'output', 'results', 'claude', 'ai'],
            component: Placeholder,
          },
          {
            key: 'message_line_clamp',
            label: 'Message Line Clamp',
            description: 'Max preview lines shown for messages in session list',
            keywords: ['message', 'preview', 'lines', 'clamp', 'truncate'],
            component: Placeholder,
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
            component: Placeholder,
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
        component: Placeholder,
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
            component: Placeholder,
          },
        ],
      },
      {
        name: 'Webhooks',
        settings: [],
      },
      {
        name: 'Query Limits',
        settings: [],
      },
      {
        name: 'Author Filters',
        settings: [
          {
            key: 'hide_gh_authors',
            label: 'Hidden Authors',
            description: 'Hide all PRs from these authors',
            keywords: ['hide', 'author', 'filter', 'github', 'pr'],
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'collapse_gh_authors',
            label: 'Collapsed Authors',
            description: 'Collapse PRs from these authors by default',
            keywords: ['collapse', 'author', 'filter', 'github', 'fold'],
            component: Placeholder,
          },
          {
            key: 'hidden_prs',
            label: 'Hidden PRs',
            description: 'Individually hidden pull requests',
            keywords: ['hide', 'pr', 'pull request', 'github', 'filter'],
            component: Placeholder,
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
            component: Placeholder,
          },
          {
            key: 'ngrok.token',
            label: 'Auth Token',
            description: 'ngrok authentication token',
            keywords: ['ngrok', 'token', 'auth', 'key', 'remote'],
            component: Placeholder,
          },
        ],
      },
      {
        name: 'SSH',
        settings: [
          {
            key: 'server_config.ssh_idle_timeout',
            label: 'SSH Idle Timeout',
            description: 'Close idle SSH connection after this period',
            keywords: ['ssh', 'idle', 'timeout', 'remote', 'disconnect'],
            component: Placeholder,
          },
          {
            key: 'server_config.ssh_default_timeout',
            label: 'SSH Command Timeout',
            description: 'Default timeout for SSH commands',
            keywords: ['ssh', 'command', 'timeout', 'remote'],
            component: Placeholder,
          },
          {
            key: 'server_config.ssh_keepalive_interval',
            label: 'SSH Keepalive Interval',
            description: 'SSH keepalive ping interval',
            keywords: ['ssh', 'keepalive', 'ping', 'heartbeat', 'remote'],
            component: Placeholder,
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
