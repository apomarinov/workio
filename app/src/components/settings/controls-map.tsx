/**
 * Maps setting keys to their control components.
 * This file is only imported by SettingsContent — changes here
 * trigger HMR for the content area without full page reloads.
 */

import { DEFAULT_CONFIG } from '@domains/settings/schema'
import { BackfillSection } from '../BackfillModal'
import { createAuthorFilterSetting } from './controls/AuthorFilterSetting'
import { HiddenPRsSetting } from './controls/HiddenPRsSetting'
import { KeymapSetting } from './controls/KeymapSetting'
import { MobileKeyboardSetting } from './controls/MobileKeyboardSetting'
import { createNumberSetting } from './controls/NumberSetting'
import { Placeholder } from './controls/Placeholder'
import { PreferredIDESetting } from './controls/PreferredIDESetting'
import { PushNotificationSetting } from './controls/PushNotificationSetting'
import { QueryLimitsSetting } from './controls/QueryLimitsSetting'
import { createSwitchSetting } from './controls/SwitchSetting'
import { createTextSetting } from './controls/TextSetting'
import { WebhooksSetting } from './controls/WebhooksSetting'
import type { SettingControlProps } from './settings-registry'

const CONTROLS_MAP: Record<string, React.ComponentType> = {
  // General > Application
  preferred_ide: PreferredIDESetting,

  // General > Notifications
  'server_config.notification_active_timeout': createNumberSetting(
    'server_config.notification_active_timeout',
    {
      min: 1000,
      placeholder: String(
        DEFAULT_CONFIG.server_config.notification_active_timeout,
      ),
      unit: 'ms',
    },
  ),

  // General > Security
  'server_config.auth_max_failures': createNumberSetting(
    'server_config.auth_max_failures',
    {
      min: 1,
      placeholder: String(DEFAULT_CONFIG.server_config.auth_max_failures),
    },
  ),
  'server_config.auth_lockout_ms': createNumberSetting(
    'server_config.auth_lockout_ms',
    {
      min: 60000,
      placeholder: String(DEFAULT_CONFIG.server_config.auth_lockout_ms),
      unit: 'ms',
    },
  ),

  // General > Notifications
  push_notifications: PushNotificationSetting,

  // Terminal
  default_shell: createTextSetting('default_shell', {
    placeholder: String(DEFAULT_CONFIG.default_shell),
  }),

  // Terminal > Display
  font_size: createNumberSetting('font_size', {
    min: 8,
    max: 32,
    placeholder: String(DEFAULT_CONFIG.font_size),
    unit: 'px',
  }),
  mobile_font_size: createNumberSetting('mobile_font_size', {
    min: 8,
    max: 32,
    placeholder: String(DEFAULT_CONFIG.mobile_font_size),
    unit: 'px',
  }),

  // Terminal > Scrollback
  'server_config.max_buffer_lines': createNumberSetting(
    'server_config.max_buffer_lines',
    {
      min: 500,
      placeholder: String(DEFAULT_CONFIG.server_config.max_buffer_lines),
    },
  ),

  // Terminal > PTY
  'server_config.session_timeout_ms': createNumberSetting(
    'server_config.session_timeout_ms',
    {
      min: 60000,
      placeholder: String(DEFAULT_CONFIG.server_config.session_timeout_ms),
      unit: 'ms',
    },
  ),
  // Terminal > Mobile Keyboard
  mobile_keyboard_rows: MobileKeyboardSetting,

  // GitHub > PR Data
  'server_config.gh_poll_interval': createNumberSetting(
    'server_config.gh_poll_interval',
    {
      min: 10000,
      placeholder: String(DEFAULT_CONFIG.server_config.gh_poll_interval),
      unit: 'ms',
    },
  ),

  // Claude > Display
  show_thinking: createSwitchSetting('show_thinking'),
  show_tools: createSwitchSetting('show_tools'),
  show_tool_output: createSwitchSetting('show_tool_output'),

  message_line_clamp: createNumberSetting('message_line_clamp', {
    min: 1,
    max: 20,
    placeholder: String(DEFAULT_CONFIG.message_line_clamp),
  }),

  // Claude > Sessions
  ignore_external_sessions: createSwitchSetting('ignore_external_sessions'),
  import_sessions: BackfillSection,

  // Keymap
  keymap: KeymapSetting,

  // GitHub > Webhooks
  repo_webhooks: WebhooksSetting,

  // GitHub > Query Limits
  gh_query_limits: QueryLimitsSetting,

  // GitHub > Author Filters
  hide_gh_authors: createAuthorFilterSetting('hide_gh_authors'),
  silence_gh_authors: createAuthorFilterSetting('silence_gh_authors'),
  collapse_gh_authors: createAuthorFilterSetting('collapse_gh_authors'),
  hidden_prs: HiddenPRsSetting,

  // Remote Access > ngrok
  'ngrok.domain': createTextSetting('ngrok.domain', {
    placeholder: 'your-domain.ngrok-free.app',
  }),
  'ngrok.token': createTextSetting('ngrok.token', {
    placeholder: 'ngrok auth token',
    secretPresent: 'ngrok.tokenPresent',
  }),

  // Remote Access > SSH
  'server_config.ssh_idle_timeout': createNumberSetting(
    'server_config.ssh_idle_timeout',
    {
      min: 60000,
      placeholder: String(DEFAULT_CONFIG.server_config.ssh_idle_timeout),
      unit: 'ms',
    },
  ),
  'server_config.ssh_default_timeout': createNumberSetting(
    'server_config.ssh_default_timeout',
    {
      min: 1000,
      placeholder: String(DEFAULT_CONFIG.server_config.ssh_default_timeout),
      unit: 'ms',
    },
  ),
  'server_config.ssh_keepalive_interval': createNumberSetting(
    'server_config.ssh_keepalive_interval',
    {
      min: 1000,
      placeholder: String(DEFAULT_CONFIG.server_config.ssh_keepalive_interval),
      unit: 'ms',
    },
  ),
}

export function getSettingControl(
  key: string,
): React.ComponentType<SettingControlProps> {
  return (CONTROLS_MAP[key] ??
    Placeholder) as React.ComponentType<SettingControlProps>
}
