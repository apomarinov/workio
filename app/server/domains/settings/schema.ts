import { z } from 'zod'

// --- Sub-schemas ---

const shortcutBindingSchema = z
  .object({
    metaKey: z.boolean().optional(),
    ctrlKey: z.boolean().optional(),
    altKey: z.boolean().optional(),
    shiftKey: z.boolean().optional(),
    key: z.string().optional(),
  })
  .refine((b) => b.metaKey || b.ctrlKey || b.altKey || b.shiftKey || b.key, {
    message: 'Shortcut must have at least one modifier or key',
  })

const keymapSchema = z.object({
  palette: shortcutBindingSchema.nullable(),
  goToTab: shortcutBindingSchema.nullable(),
  goToShell: shortcutBindingSchema.nullable(),
  prevShell: shortcutBindingSchema.nullable(),
  nextShell: shortcutBindingSchema.nullable(),
  togglePip: shortcutBindingSchema.nullable(),
  itemActions: shortcutBindingSchema.nullable(),
  collapseAll: shortcutBindingSchema.nullable(),
  settings: shortcutBindingSchema.nullable(),
  newShell: shortcutBindingSchema.nullable(),
  closeShell: shortcutBindingSchema.nullable(),
  commitAmend: shortcutBindingSchema.nullable(),
  commitNoVerify: shortcutBindingSchema.nullable(),
  shellTemplates: shortcutBindingSchema.nullable(),
  customCommands: shortcutBindingSchema.nullable(),
  branches: shortcutBindingSchema.nullable(),
  pullBranch: shortcutBindingSchema.nullable(),
  toggleSidebar: shortcutBindingSchema.nullable(),
  commit: shortcutBindingSchema.nullable(),
})

const repoWebhookStatusSchema = z.object({
  id: z.number(),
  missing: z.boolean().optional(),
})

const hiddenGHAuthorSchema = z.object({
  repo: z.string(),
  author: z.string(),
})

const hiddenPRSchema = z.object({
  repo: z.string(),
  prNumber: z.number(),
  title: z.string(),
})

const ghQueryLimitsSchema = z.object({
  checks: z.number(),
  reviews: z.number(),
  comments: z.number(),
  review_threads: z.number(),
  thread_comments: z.number(),
  review_requests: z.number(),
  reactors: z.number(),
})

const shellTemplateEntrySchema = z.object({
  name: z.string(),
  command: z.string(),
})

const shellTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  entries: z.array(shellTemplateEntrySchema),
})

const mobileKeyboardRowSchema = z.object({
  id: z.string(),
  actions: z.array(z.string()),
})

const customTerminalActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  repo: z.string().optional(),
})

const pushSubscriptionRecordSchema = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  userAgent: z.string().optional(),
  created_at: z.string(),
})

const statusBarSectionNameSchema = z.enum([
  'pr',
  'resources',
  'processes',
  'ports',
  'gitDirty',
  'lastCommit',
  'branch',
  'spacer',
])

const statusBarSectionSchema = z.object({
  name: statusBarSectionNameSchema,
  visible: z.boolean(),
  order: z.number(),
})

const statusBarConfigSchema = z.object({
  enabled: z.boolean(),
  onTop: z.boolean(),
  sections: z.array(statusBarSectionSchema),
})

// --- Defaults ---

export const DEFAULT_KEYMAP: z.input<typeof keymapSchema> = {
  palette: { metaKey: true, key: 'k' },
  goToTab: { metaKey: true },
  goToShell: { altKey: true },
  prevShell: { altKey: true, key: 'bracketleft' },
  nextShell: { altKey: true, key: 'bracketright' },
  togglePip: { metaKey: true, key: 'p' },
  itemActions: { metaKey: true, key: 'i' },
  collapseAll: { metaKey: true, key: 'arrowup' },
  settings: { metaKey: true, key: 'comma' },
  newShell: { altKey: true, key: 'n' },
  closeShell: { altKey: true, key: 'w' },
  commitAmend: { altKey: true, key: 'a' },
  commitNoVerify: { altKey: true, key: 'n' },
  shellTemplates: { shiftKey: true, altKey: true, key: 'k' },
  customCommands: { altKey: true, key: 'a' },
  branches: { ctrlKey: true, shiftKey: true, key: 'enter' },
  pullBranch: { metaKey: true, key: 't' },
  toggleSidebar: { altKey: true, key: 'backquote' },
  commit: { metaKey: true, shiftKey: true, key: 'k' },
}

export const DEFAULT_GH_QUERY_LIMITS: z.input<typeof ghQueryLimitsSchema> = {
  checks: 5,
  reviews: 10,
  comments: 10,
  review_threads: 10,
  thread_comments: 10,
  review_requests: 10,
  reactors: 3,
}

export const DEFAULT_STATUS_BAR: z.input<typeof statusBarConfigSchema> = {
  enabled: true,
  onTop: false,
  sections: [
    { name: 'branch', visible: true, order: 0 },
    { name: 'lastCommit', visible: true, order: 1 },
    { name: 'gitDirty', visible: true, order: 2 },
    { name: 'spacer', visible: true, order: 3 },
    { name: 'resources', visible: true, order: 4 },
    { name: 'processes', visible: true, order: 5 },
    { name: 'ports', visible: true, order: 6 },
    { name: 'pr', visible: true, order: 7 },
  ],
}

// --- Config schema (stored fields with defaults) ---

const settingsBaseSchema = z.object({
  default_shell: z.string().default('/bin/bash'),
  font_size: z.number().min(8).max(32).nullable().default(null),
  mobile_font_size: z.number().min(8).max(32).nullable().default(null),
  show_thinking: z.boolean().default(false),
  show_tools: z.boolean().default(true),
  show_tool_output: z.boolean().default(false),
  message_line_clamp: z.number().min(1).max(20).default(5),
  preferred_ide: z.enum(['cursor', 'vscode']).default('cursor'),
  keymap: keymapSchema.optional().default(DEFAULT_KEYMAP),
  gh_query_limits: ghQueryLimitsSchema
    .optional()
    .default(DEFAULT_GH_QUERY_LIMITS),
  ignore_external_sessions: z.boolean().default(false),
  // Server-managed fields (not user-editable)
  webhook_secret: z.string().optional(),
  ngrok_url: z.string().optional(),
  repo_webhooks: z.record(z.string(), repoWebhookStatusSchema).optional(),
  vapid_public_key: z.string().optional(),
  vapid_private_key: z.string().optional(),
  push_subscriptions: z.array(pushSubscriptionRecordSchema).optional(),
  // User-editable collections
  hide_gh_authors: z.array(hiddenGHAuthorSchema).optional(),
  silence_gh_authors: z.array(hiddenGHAuthorSchema).optional(),
  collapse_gh_authors: z.array(hiddenGHAuthorSchema).optional(),
  hidden_prs: z.array(hiddenPRSchema).optional(),
  favorite_sessions: z.array(z.string()).optional(),
  shell_templates: z.array(shellTemplateSchema).optional(),
  mobile_keyboard_rows: z.array(mobileKeyboardRowSchema).optional(),
  custom_terminal_actions: z.array(customTerminalActionSchema).optional(),
  terminal_order: z.array(z.number()).optional(),
  shell_order: z.record(z.string(), z.array(z.number())).optional(),
  starred_branches: z.record(z.string(), z.array(z.string())).optional(),
  statusBar: statusBarConfigSchema.optional().default(DEFAULT_STATUS_BAR),
})

/** Default config derived from schema defaults */
export const DEFAULT_CONFIG = settingsBaseSchema.parse({})

// --- Full settings (config + id) ---

export const settingsSchema = settingsBaseSchema.extend({
  id: z.number(),
})

// --- Input schemas ---

/** Fields the client cannot set directly */
const SERVER_ONLY_FIELDS = {
  webhook_secret: true,
  ngrok_url: true,
  vapid_public_key: true,
  vapid_private_key: true,
} as const

export const updateSettingsInput = settingsBaseSchema
  .omit(SERVER_ONLY_FIELDS)
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one setting must be provided',
  })

export const pushSubscribeInput = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  userAgent: z.string().optional(),
})

export const pushUnsubscribeInput = z.object({
  endpoint: z.string(),
})

// --- Types ---

type Settings = z.infer<typeof settingsSchema>
export type SettingsUpdate = z.infer<typeof updateSettingsInput>
export type SettingsUpdateInternal = Partial<Omit<Settings, 'id'>>
export type ShortcutBinding = z.infer<typeof shortcutBindingSchema>
export type Keymap = z.infer<typeof keymapSchema>
export type HiddenGHAuthor = z.infer<typeof hiddenGHAuthorSchema>
export type HiddenPR = z.infer<typeof hiddenPRSchema>
export type GHQueryLimits = z.infer<typeof ghQueryLimitsSchema>
export type ShellTemplateEntry = z.infer<typeof shellTemplateEntrySchema>
export type ShellTemplate = z.infer<typeof shellTemplateSchema>
export type MobileKeyboardRow = z.infer<typeof mobileKeyboardRowSchema>
export type CustomTerminalAction = z.infer<typeof customTerminalActionSchema>
export type PushSubscriptionRecord = z.infer<
  typeof pushSubscriptionRecordSchema
>
export type StatusBarSectionName = z.infer<typeof statusBarSectionNameSchema>
export type StatusBarSection = z.infer<typeof statusBarSectionSchema>
export type StatusBarConfig = z.infer<typeof statusBarConfigSchema>
export type PreferredIDE = Settings['preferred_ide']
