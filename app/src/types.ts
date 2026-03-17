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
  active_cmd: string | null
  created_at: string
}

export interface PortMapping {
  port: number // remote port
  localPort: number // local port
}

export interface Terminal {
  id: number
  cwd: string
  name: string | null
  shell: string | null
  ssh_host: string | null
  pid: number | null
  status: 'running' | 'stopped'
  git_branch: string | null
  git_repo: GitRepoStatus | null
  setup: SetupStatus | null
  settings: {
    defaultClaudeCommand?: string
    portMappings?: PortMapping[]
  } | null
  shells: Shell[]
  orphaned?: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  host: string
  path: string
}

export interface SessionBranchEntry {
  branch: string
  repo: string
}

export interface SessionData {
  branch?: string
  repo?: string
  branches?: SessionBranchEntry[]
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
  data: SessionData | null
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
  updated_at: string
  data: SessionData | null
  messages: { id: number; body: string; is_user: boolean }[]
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
  last_message?: string
}

import type {
  ShortcutBinding,
  StatusBarConfig,
  StatusBarSection,
  StatusBarSectionName,
} from '@domains/settings/schema'

// Map event.code-based key names to display characters
export const CODE_TO_DISPLAY: Record<string, string> = {
  bracketleft: '[',
  bracketright: ']',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
}

// Convert event.code to our normalized key name (lowercase, no prefix)
export function mapEventCode(code: string): string {
  // KeyA → a, KeyZ → z
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  // Digit0 → 0
  if (code.startsWith('Digit')) return code.slice(5)
  // BracketLeft → bracketleft, ArrowUp → arrowup, Comma → comma
  return code.toLowerCase()
}

// Convert a ShortcutBinding to a react-hotkeys-hook hotkey string
export function bindingToHotkeyString(b: ShortcutBinding): string {
  const parts: string[] = []
  if (b.ctrlKey) parts.push('ctrl')
  if (b.altKey) parts.push('alt')
  if (b.shiftKey) parts.push('shift')
  if (b.metaKey) parts.push('meta')
  if (b.key) parts.push(b.key)
  return parts.join('+')
}

export interface NotificationData {
  // Auth fields
  attempts?: number
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
  repo: string | null
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

export const STATUS_BAR_SECTION_LABELS: Record<StatusBarSectionName, string> = {
  pr: 'Pull Request',
  resources: 'Resources',
  processes: 'Processes',
  ports: 'Ports',
  gitDirty: 'Git Changes',
  lastCommit: 'Last Commit',
  branch: 'Branch',
  spacer: 'Spacer',
}

export const DEFAULT_STATUS_BAR_SECTIONS: StatusBarSection[] = [
  { name: 'branch', visible: true, order: 0 },
  { name: 'lastCommit', visible: true, order: 1 },
  { name: 'gitDirty', visible: true, order: 2 },
  { name: 'spacer', visible: true, order: 3 },
  { name: 'resources', visible: true, order: 4 },
  { name: 'processes', visible: true, order: 5 },
  { name: 'ports', visible: true, order: 6 },
  { name: 'pr', visible: true, order: 7 },
]

export const DEFAULT_STATUS_BAR: StatusBarConfig = {
  enabled: true,
  onTop: false,
  sections: DEFAULT_STATUS_BAR_SECTIONS,
}
