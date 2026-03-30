/**
 * Settings registry — defines the structure, metadata, and search keywords
 * for every setting rendered in the settings view. No component imports here
 * to keep this module HMR-safe (changes don't cause full page reloads).
 *
 * Component resolution happens in controls-map.tsx, imported only by SettingsContent.
 */

import { Github, Globe, Keyboard, Monitor, Settings } from 'lucide-react'
import { ClaudeIcon } from '@/components/icons'

// --- Setting definition ---

type IconComponent = React.ComponentType<{ className?: string }>

export interface SettingControlProps {
  onWarning?: (warning: boolean) => void
}

export interface SettingDef {
  /** Unique key for this setting, used for component lookup and search identity */
  key: string
  label: string
  description: string
  /** Render label and control stacked vertically instead of side-by-side */
  column?: boolean
  /** Start collapsed — shows a chevron to expand/collapse the control */
  collapsed?: boolean
}

export interface SettingsSection {
  name: string
  description?: string
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
          },
          {
            key: 'push_notifications',
            label: 'Mobile Notifications',
            description: 'Get notified even when the app is closed',
            column: true,
            collapsed: true,
          },
        ],
      },
      {
        name: 'Security',
        description:
          'Set BASIC_AUTH environment variable with your credentials to enable authentication.',
        settings: [
          {
            key: 'server_config.auth_max_failures',
            label: 'Max Login Failures',
            description: 'Failed login attempts before lockout',
          },
          {
            key: 'server_config.auth_lockout_ms',
            label: 'Lockout Duration',
            description: 'How long an IP stays locked out',
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
        name: 'General',
        settings: [
          {
            key: 'default_shell',
            label: 'Default Shell',
            description: 'Shell used when creating new terminals',
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
          },
          {
            key: 'mobile_font_size',
            label: 'Mobile Font Size',
            description: 'Terminal font size (mobile)',
          },
        ],
      },
      {
        name: 'Scrollback',
        settings: [
          {
            key: 'scrollback',
            label: 'Client',
            description: 'Lines retained in the terminal view',
          },
          {
            key: 'server_config.max_buffer_lines',
            label: 'Server',
            description: 'Lines retained in the server-side output buffer',
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
          },
        ],
      },
      {
        name: 'Mobile Keyboard',
        settings: [
          {
            key: 'mobile_keyboard_rows',
            label: 'Terminal Actions',
            description: 'Customize mobile keyboard action rows',
            column: true,
            collapsed: true,
          },
        ],
      },
      {
        name: 'Custom Commands',
        settings: [
          {
            key: 'custom_terminal_actions',
            label: 'Custom Commands',
            description: 'Set up your frequently used CLI commands',
            column: true,
            collapsed: true,
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
          },
          {
            key: 'show_tools',
            label: 'Show Tool Calls',
            description: 'Display tool call blocks in conversations',
          },
          {
            key: 'show_tool_output',
            label: 'Show Tool Output',
            description:
              'Display tool call results (only when Show Tool Calls is on)',
          },
          {
            key: 'message_line_clamp',
            label: 'Message Line Clamp',
            description: 'Max preview lines shown for messages in session list',
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
          },
          {
            key: 'import_sessions',
            label: 'Import Sessions',
            description: 'Import untracked Claude Code sessions',
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
          },
        ],
      },
      {
        name: 'Webhooks',
        settings: [
          {
            key: 'repo_webhooks',
            label: 'Repo Webhooks',
            description: 'Manage GitHub webhook registrations per repo',
            column: true,
            collapsed: true,
          },
        ],
      },
      {
        name: 'Query Limits',
        settings: [
          {
            key: 'gh_query_limits',
            label: 'GraphQL Query Limits',
            description: 'Control how much data to fetch per PR from GitHub',
            column: true,
            collapsed: true,
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
            column: true,
            collapsed: true,
          },
          {
            key: 'silence_gh_authors',
            label: 'Silenced Authors',
            description: 'Suppress notifications but show PRs',
            column: true,
            collapsed: true,
          },
          {
            key: 'collapse_gh_authors',
            label: 'Collapsed Authors',
            description: 'Collapse PRs from these authors by default',
            column: true,
            collapsed: true,
          },
          {
            key: 'hidden_prs',
            label: 'Hidden PRs',
            description: 'Individually hidden pull requests',
            column: true,
            collapsed: true,
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
          },
          {
            key: 'ngrok.token',
            label: 'Auth Token',
            description: 'ngrok authentication token',
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
          },
          {
            key: 'server_config.ssh_default_timeout',
            label: 'SSH Command Timeout',
            description: 'Default timeout for SSH commands',
          },
          {
            key: 'server_config.ssh_max_channels',
            label: 'Max SSH Channels',
            description: 'Max concurrent SSH exec channels per connection',
          },
          {
            key: 'server_config.ssh_keepalive_interval',
            label: 'SSH Keepalive Interval',
            description: 'SSH keepalive ping interval',
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

/** Search settings by query string, matching against label, description, and ancestors */
export function searchSettings(query: string): FlatSetting[] {
  if (!query.trim()) return flattenSettings()
  const terms = query.toLowerCase().split(/\s+/)
  return flattenSettings().filter((s) => {
    const haystack = [s.label, s.description, ...s.ancestors]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
