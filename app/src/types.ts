export interface Terminal {
  id: number
  cwd: string
  name: string | null
  shell: string | null
  pid: number | null
  status: 'running' | 'stopped'
  active_cmd: string | null
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
  name: string | null
  git_branch: string | null
  message_count: number | null
  status: 'started' | 'active' | 'done' | 'ended' | 'permission_needed' | 'idle'
  transcript_path: string | null
  created_at: string
  updated_at: string
}

export interface SessionWithProject extends Session {
  project_path: string
  latest_user_message: string | null
  latest_agent_message: string | null
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
  status: 'success' | 'error'
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
  output: string
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
}

export type ToolData =
  | BashTool
  | EditTool
  | ReadTool
  | WriteTool
  | GrepTool
  | TaskTool
  | TodoWriteTool
  | GenericTool

export interface Message {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  todo_id: string | null
  body: string | null
  tools: ToolData | null
  created_at: string
  updated_at: string | null
}

export interface SessionMessage extends Message {
  prompt_text: string | null
}

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
}

export interface Settings {
  id: number
  default_shell: string
  font_size: number | null
  show_thinking: boolean
  show_tool_output: boolean
  message_line_clamp: number
}
