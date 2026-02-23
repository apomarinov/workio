export interface GitRepoStatus {
  repo: string
  status: 'setup' | 'done' | 'failed'
  workspaces_root?: string
  error?: string
}

export interface SetupStatus {
  conductor?: boolean
  setup?: string
  delete?: string
  status: 'setup' | 'delete' | 'done' | 'failed'
  error?: string
}

export interface Shell {
  id: number
  terminal_id: number
  name: string
  created_at: string
  isSuspended?: boolean
}

export interface Terminal {
  id: number
  cwd: string
  name: string | null
  shell: string | null
  ssh_host: string | null
  pid: number | null
  status: 'running' | 'stopped'
  active_cmd: string | null
  git_branch: string | null
  git_repo: GitRepoStatus | null
  setup: SetupStatus | null
  settings: { defaultClaudeCommand?: string } | null
  shells: Shell[]
  orphaned?: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  path: string
}

export interface Session {
  session_id: string
  project_id: number
  terminal_id: number | null
  shell_id: number | null
  name: string | null
  message_count: number | null
  status: 'started' | 'active' | 'done' | 'ended' | 'permission_needed' | 'idle'
  transcript_path: string | null
  data: { branch?: string } | null
  created_at: string
  updated_at: string
}

export interface SessionWithProject extends Session {
  project_path: string
  latest_user_message: string | null
  latest_agent_message: string | null
  is_favorite: boolean
}

export interface MoveTarget {
  projectPath: string
  encodedPath: string
  terminalId: number
  terminalName: string | null
  sshHost: string | null
  claudeDirExists: boolean
}

export interface SessionSearchMatch {
  session_id: string
  name: string | null
  terminal_name: string | null
  project_path: string
  status: string
  data: { branch?: string } | null
  messages: { body: string; is_user: boolean }[]
}

export interface Prompt {
  id: number
  session_id: string
  prompt: string | null
  created_at: string
}

// Tool input types
export interface BashInput {
  command: string
  description?: string | null
}

export interface EditInput {
  file_path: string
  replace_all?: boolean
}

export interface ReadInput {
  file_path: string
  offset?: number | null
  limit?: number | null
}

export interface WriteInput {
  file_path: string
}

export interface GrepInput {
  pattern: string
  path?: string | null
  glob?: string | null
  output_mode?: string | null
}

export interface TaskInput {
  description: string
  subagent_type: string
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export interface TodoWriteInput {
  todos: TodoItem[]
}

// Tool data types
interface BaseTool {
  tool_use_id: string
  name: string
  status: 'success' | 'error' | 'pending'
}

export interface BashTool extends BaseTool {
  name: 'Bash'
  input: BashInput
  output: string
  output_truncated: boolean
}

export interface EditTool extends BaseTool {
  name: 'Edit'
  input: EditInput
  diff: string
  lines_added: number
  lines_removed: number
  diff_truncated: boolean
}

export interface ReadTool extends BaseTool {
  name: 'Read'
  input: ReadInput
  output?: string
  output_truncated: boolean
}

export interface WriteTool extends BaseTool {
  name: 'Write'
  input: WriteInput
  content: string
  content_truncated: boolean
}

export interface GrepTool extends BaseTool {
  name: 'Grep' | 'Glob'
  input: GrepInput
  output: string
  output_truncated: boolean
}

export interface TaskTool extends BaseTool {
  name: 'Task'
  input: TaskInput
  output: string
  output_truncated: boolean
}

export interface TodoWriteTool extends BaseTool {
  name: 'TodoWrite'
  input: TodoWriteInput
}

export interface GenericTool extends BaseTool {
  input: Record<string, unknown>
  output?: string
  output_truncated?: boolean
  answers?: Record<string, string>
}

export type PermissionPromptType = 'plan_mode' | 'tool_permission'

export interface PermissionOption {
  number: number
  label: string
  keySequence: string
}

export interface PermissionPromptInput {
  type: PermissionPromptType
  title: string
  question: string
  context: string
  options: PermissionOption[]
}

export interface PermissionPromptTool extends BaseTool {
  name: 'PermissionPrompt'
  input: PermissionPromptInput
}

export type ToolData =
  | BashTool
  | EditTool
  | ReadTool
  | WriteTool
  | GrepTool
  | TaskTool
  | TodoWriteTool
  | PermissionPromptTool
  | GenericTool

export interface MessageImage {
  media_type: string
  data: string
}

export interface Message {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  todo_id: string | null
  body: string | null
  tools: ToolData | null
  images: MessageImage[] | null
  created_at: string
  updated_at: string | null
}

export interface SessionMessage extends Message {
  prompt_text: string | null
}

export type GroupedMessage =
  | { type: 'message'; message: SessionMessage }
  | { type: 'thinking'; messages: SessionMessage[] }

export interface SessionMessagesResponse {
  messages: SessionMessage[]
  total: number
  hasMore: boolean
}

export interface Hook {
  id: number
  session_id: string
  hook_type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface HookEvent {
  session_id: string
  hook_type: string
  status: string | null
  project_path: string
  terminal_id: number | null
  shell_id: number | null
}

export interface ShortcutBinding {
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  key?: string
}

export interface Keymap {
  palette: ShortcutBinding | null
  goToTab: ShortcutBinding | null
  goToLastTab: ShortcutBinding | null
  goToShell: ShortcutBinding | null
  prevShell: ShortcutBinding | null
  nextShell: ShortcutBinding | null
  togglePip: ShortcutBinding | null
  itemActions: ShortcutBinding | null
  collapseAll: ShortcutBinding | null
  settings: ShortcutBinding | null
  newShell: ShortcutBinding | null
  closeShell: ShortcutBinding | null
  commitAmend: ShortcutBinding | null
  commitNoVerify: ShortcutBinding | null
}

export const DEFAULT_KEYMAP: Keymap = {
  palette: { metaKey: true, key: 'k' },
  goToTab: { metaKey: true },
  goToLastTab: { metaKey: true, shiftKey: true },
  goToShell: { altKey: true },
  prevShell: { metaKey: true, key: '[' },
  nextShell: { metaKey: true, key: ']' },
  togglePip: { metaKey: true, key: 'p' },
  itemActions: { metaKey: true, key: 'i' },
  collapseAll: { metaKey: true, key: 'arrowup' },
  settings: { metaKey: true, key: ',' },
  newShell: { altKey: true, key: 'n' },
  closeShell: { altKey: true, key: 'w' },
  commitAmend: { altKey: true, key: 'a' },
  commitNoVerify: { altKey: true, key: 'n' },
}

export interface RepoWebhookStatus {
  id: number
  missing?: boolean
}

export interface HiddenGHAuthor {
  repo: string
  author: string
}

export interface HiddenPR {
  repo: string
  prNumber: number
  title: string
}

export interface NotificationData {
  // PR fields
  prTitle?: string
  prUrl?: string
  prNumber?: number
  reviewer?: string
  approver?: string
  author?: string
  body?: string
  commentUrl?: string
  commentId?: number
  checkName?: string
  checkUrl?: string
  state?: string
  reviewId?: number
  // Workspace fields
  terminalId?: number
  name?: string // workspace name
  deleted?: boolean
  git_repo?: GitRepoStatus
  setup?: SetupStatus
}

export interface Notification {
  id: number
  dedup_hash: string | null
  type: string
  repo: string
  read: boolean
  created_at: string
  data: NotificationData
}

export interface CommandLog {
  id: number
  terminal_id: number | null
  pr_id: string | null // "owner/repo#123" format
  exit_code: number
  category: string
  data: {
    command: string
    stdout?: string
    stderr?: string
    sshHost?: string
    terminalName?: string
  }
  created_at: string
}

export interface LogTerminal {
  id: number
  name: string
  deleted: boolean
}

export interface ShellTemplateEntry {
  name: string
  command: string
}

export interface ShellTemplate {
  id: string
  name: string
  entries: ShellTemplateEntry[]
}

export interface MobileKeyboardRow {
  id: string
  actions: string[] // action IDs, max 8 per row
}

export interface CustomTerminalAction {
  id: string // e.g. "custom-1708901234-abc123"
  label: string // user-defined display label
  command: string // text to send to terminal (+ \r appended on send)
}

export type PreferredIDE = 'cursor' | 'vscode'

export interface Settings {
  id: number
  default_shell: string
  font_size: number | null
  show_thinking: boolean
  show_tools: boolean
  show_tool_output: boolean
  message_line_clamp: number
  preferred_ide: PreferredIDE
  keymap?: Keymap
  webhook_secret?: string
  ngrok_url?: string
  repo_webhooks?: Record<string, RepoWebhookStatus>
  hide_gh_authors?: HiddenGHAuthor[]
  silence_gh_authors?: HiddenGHAuthor[]
  collapse_gh_authors?: HiddenGHAuthor[]
  hidden_prs?: HiddenPR[]
  favorite_sessions?: string[]
  shell_templates?: ShellTemplate[]
  mobile_keyboard_rows?: MobileKeyboardRow[]
  custom_terminal_actions?: CustomTerminalAction[]
  // Computed webhook warning counts
  missingWebhookCount?: number
  orphanedWebhookCount?: number
}
