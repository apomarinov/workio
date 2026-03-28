/**
 * Maps setting keys to their control components.
 * This file is only imported by SettingsContent — changes here
 * trigger HMR for the content area without full page reloads.
 */

import { DEFAULT_CONFIG } from '@domains/settings/schema'
import { createNumberSetting } from './controls/NumberSetting'
import { Placeholder } from './controls/Placeholder'
import { PreferredIDESetting } from './controls/PreferredIDESetting'
import { createTextSetting } from './controls/TextSetting'

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
}

export function getSettingControl(key: string): React.ComponentType {
  return CONTROLS_MAP[key] ?? Placeholder
}
