import type {
  PermissionOption,
  PermissionPromptType,
} from '@domains/pty/schema'

// --- Tool input types ---

export type BashInput = {
  command: string
  description?: string | null
}

export type EditInput = {
  file_path: string
  replace_all?: boolean
}

export type ReadInput = {
  file_path: string
  offset?: number | null
  limit?: number | null
}

export type WriteInput = {
  file_path: string
}

export type GrepInput = {
  pattern: string
  path?: string | null
  glob?: string | null
  output_mode?: string | null
}

export type TaskInput = {
  description: string
  subagent_type: string
}

export type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export type TodoWriteInput = {
  todos: TodoItem[]
}

// --- Tool data types ---

type BaseTool = {
  tool_use_id: string
  name: string
  status: 'success' | 'error' | 'pending'
}

export type BashTool = BaseTool & {
  name: 'Bash'
  input: BashInput
  output: string
  output_truncated: boolean
}

export type EditTool = BaseTool & {
  name: 'Edit'
  input: EditInput
  diff: string
  lines_added: number
  lines_removed: number
  diff_truncated: boolean
}

export type ReadTool = BaseTool & {
  name: 'Read'
  input: ReadInput
  output?: string
  output_truncated: boolean
}

export type WriteTool = BaseTool & {
  name: 'Write'
  input: WriteInput
  content: string
  content_truncated: boolean
}

export type GrepTool = BaseTool & {
  name: 'Grep' | 'Glob'
  input: GrepInput
  output: string
  output_truncated: boolean
}

export type TaskTool = BaseTool & {
  name: 'Task'
  input: TaskInput
  output: string
  output_truncated: boolean
}

export type TodoWriteTool = BaseTool & {
  name: 'TodoWrite'
  input: TodoWriteInput
}

export type GenericTool = BaseTool & {
  input: Record<string, unknown>
  output?: string
  output_truncated?: boolean
  answers?: Record<string, string>
}

export type PermissionPromptInput = {
  type: PermissionPromptType
  title: string
  question: string
  context: string
  options: PermissionOption[]
}

export type PermissionPromptTool = BaseTool & {
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

// --- Message types ---

export type MessageImage = {
  media_type: string
  data: string
}

export type Message = {
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

export type SessionMessage = Message & {
  prompt_text: string | null
}

export type GroupedMessage =
  | { type: 'message'; message: SessionMessage }
  | { type: 'thinking'; messages: SessionMessage[] }
