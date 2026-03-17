export type AudioType =
  | 'permission'
  | 'done'
  | 'pr-activity'
  | 'error'
  | 'bell-notify'

export interface NotificationDef {
  emoji: string
  icon?: string
  iconColor?: string
  titleTemplate: string
  bodyTemplate: string
  audio: AudioType
}

export const NOTIFICATION_REGISTRY: Record<string, NotificationDef> = {
  // PR notifications
  pr_merged: {
    emoji: '✅',
    icon: 'GitMerge',
    iconColor: 'text-purple-400',
    titleTemplate: 'Merged',
    bodyTemplate: '{prTitle}',
    audio: 'pr-activity',
  },
  pr_closed: {
    emoji: '🚫',
    icon: 'GitPullRequestArrow',
    iconColor: 'text-red-400',
    titleTemplate: 'Closed',
    bodyTemplate: '{prTitle}',
    audio: 'pr-activity',
  },
  checks_passed: {
    emoji: '✅',
    icon: 'CircleCheck',
    iconColor: 'text-green-500',
    titleTemplate: 'All checks passed',
    bodyTemplate: '{prTitle}',
    audio: 'done',
  },
  check_failed: {
    emoji: '❌',
    icon: 'CircleX',
    iconColor: 'text-red-400',
    titleTemplate: '"{checkName|Check}" Failed',
    bodyTemplate: '{prTitle}',
    audio: 'error',
  },
  changes_requested: {
    emoji: '🔄',
    icon: 'RefreshIcon',
    iconColor: 'text-orange-400',
    titleTemplate: '{reviewer|Changes requested}',
    bodyTemplate: '{prTitle}',
    audio: 'error',
  },
  pr_approved: {
    emoji: '✅',
    icon: 'Check',
    iconColor: 'text-green-500',
    titleTemplate: '{approver|Approved}',
    bodyTemplate: '{prTitle}',
    audio: 'pr-activity',
  },
  new_comment: {
    emoji: '💬',
    icon: 'MessageSquare',
    iconColor: 'text-muted-foreground',
    titleTemplate: '{author|Someone}',
    bodyTemplate: '{prTitle}',
    audio: 'pr-activity',
  },
  new_review: {
    emoji: '💬',
    icon: 'Eye',
    iconColor: 'text-blue-500',
    titleTemplate: '{author|Someone}',
    bodyTemplate: '{prTitle}',
    audio: 'pr-activity',
  },
  review_requested: {
    emoji: '👀',
    icon: 'Eye',
    iconColor: 'text-blue-400',
    titleTemplate: '{author|Review requested}',
    bodyTemplate: 'wants your review on {prTitle}',
    audio: 'pr-activity',
  },
  pr_mentioned: {
    emoji: '💬',
    icon: 'AtSign',
    iconColor: 'text-yellow-400',
    titleTemplate: '{author|Mentioned}',
    bodyTemplate: 'mentioned you in {prTitle}',
    audio: 'pr-activity',
  },
  // Workspace notifications
  workspace_ready: {
    emoji: '✅',
    icon: 'Terminal',
    iconColor: 'text-green-500',
    titleTemplate: '{name|Workspace}',
    bodyTemplate: 'Workspace Ready',
    audio: 'pr-activity',
  },
  workspace_failed: {
    emoji: '❌',
    icon: 'Terminal',
    iconColor: 'text-red-500',
    titleTemplate: '{name|Workspace}',
    bodyTemplate: 'Workspace Failed',
    audio: 'error',
  },
  workspace_deleted: {
    emoji: '✅',
    icon: 'Terminal',
    iconColor: 'text-green-500',
    titleTemplate: '{name|Workspace}',
    bodyTemplate: 'Workspace Deleted',
    audio: 'pr-activity',
  },
  workspace_repo_failed: {
    emoji: '❌',
    icon: 'Terminal',
    iconColor: 'text-red-500',
    titleTemplate: '{name|Workspace}',
    bodyTemplate: 'Repo init failed',
    audio: 'error',
  },
  // Security notifications
  auth_lockout: {
    emoji: '🚨',
    icon: 'ShieldAlert',
    iconColor: 'text-red-500',
    titleTemplate: 'Failed Login Detected',
    bodyTemplate:
      '{attempts} failed login attempts on ngrok — endpoint locked for 10min',
    audio: 'error',
  },
  // OS/push-only types (no icon/iconColor)
  permission_needed: {
    emoji: '⚠️',
    titleTemplate: '{userMessage|Permission Required}',
    bodyTemplate: '{permissionDetail|needs permissions}',
    audio: 'permission',
  },
  stop: {
    emoji: '✅',
    titleTemplate: '{terminalName|Claude}',
    bodyTemplate: '{lastMessage|Done}',
    audio: 'done',
  },
  bell_notify: {
    emoji: '🔔',
    titleTemplate: '{command}',
    bodyTemplate: '{terminalName}',
    audio: 'bell-notify',
  },
}

/** Replace `{field}` and `{field|fallback}` in a template string */
export function resolveTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_, key, fallback) => {
    const value = data[key]
    if (value != null && value !== '') return String(value)
    return fallback ?? ''
  })
}

/** Get emoji for a notification type, handling conditional cases */
export function getEmoji(type: string, data: Record<string, unknown>): string {
  if (type === 'new_review') {
    if (data.state === 'APPROVED') return '✅'
    if (data.state === 'CHANGES_REQUESTED') return '🔄'
    return '💬'
  }
  if (type === 'bell_notify') {
    return data.exitCode === 0 ? '✅' : '❌'
  }
  return NOTIFICATION_REGISTRY[type]?.emoji ?? ''
}

/** Resolve a notification to its final emoji, title, body, audio, and optional icon/iconColor */
export function resolveNotification(
  type: string,
  data: Record<string, unknown>,
) {
  const def = NOTIFICATION_REGISTRY[type]
  if (!def) {
    return {
      emoji: '',
      title: type,
      body: '',
      audio: 'pr-activity' as AudioType,
      icon: undefined,
      iconColor: undefined,
    }
  }

  return {
    emoji: getEmoji(type, data),
    title: resolveTemplate(def.titleTemplate, data),
    body: resolveTemplate(def.bodyTemplate, data),
    audio: def.audio,
    icon: def.icon,
    iconColor: def.iconColor,
  }
}
