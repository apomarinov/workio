import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  FileCode,
  FilePen,
  FileSearch,
  FileText,
  ListTodo,
  Search,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type {
  BashTool,
  EditTool,
  GenericTool,
  GrepTool,
  ReadTool,
  TaskTool,
  TodoWriteTool,
  ToolData,
  WriteTool,
} from '../types'
import { DiffView } from './DiffView'

interface ToolCallDisplayProps {
  tool: ToolData
}

function StatusDot({ status }: { status: 'success' | 'error' }) {
  return status === 'success' ? (
    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
  ) : (
    <XCircle className="w-3.5 h-3.5 text-red-500" />
  )
}

function ToolHeader({
  icon: Icon,
  label,
  status,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  status: 'success' | 'error'
  meta?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusDot status={status} />
      <Icon className="w-4 h-4 text-zinc-400" />
      <span className="font-mono text-zinc-300">{label}</span>
      {meta && <span className="text-xs text-zinc-500">{meta}</span>}
    </div>
  )
}

function CollapsibleOutput({
  output,
  truncated,
  defaultOpen = false,
}: {
  output: string
  truncated: boolean
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const hasOutput = output && output.trim().length > 0

  if (!hasOutput) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>{expanded ? 'Hide output' : 'Show output'}</span>
        {truncated && <span className="text-amber-500">(truncated)</span>}
      </button>
      {expanded && (
        <pre className="mt-1 p-2 bg-zinc-900 rounded text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
          {output}
        </pre>
      )}
    </div>
  )
}

function BashToolDisplay({ tool }: { tool: BashTool }) {
  const command =
    tool.input.command.length > 60
      ? `${tool.input.command.slice(0, 60)}...`
      : tool.input.command

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={Terminal}
        label={command}
        status={tool.status}
        meta={tool.input.description}
      />
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
      />
    </div>
  )
}

function EditToolDisplay({ tool }: { tool: EditTool }) {
  const [expanded, setExpanded] = useState(false)
  const fileName = tool.input.file_path.split('/').pop() || tool.input.file_path

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FilePen}
        label={`Update ${fileName}`}
        status={tool.status}
        meta={
          <>
            <span className="text-green-400">+{tool.lines_added}</span>
            <span className="text-red-400">-{tool.lines_removed}</span>
          </>
        }
      />
      <div className="text-xs text-zinc-500 font-mono pl-6">
        {tool.input.file_path}
      </div>
      {tool.diff_truncated ? (
        <p className="text-xs text-zinc-500 pl-6">
          [Diff too large to display]
        </p>
      ) : (
        tool.diff && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span>{expanded ? 'Hide diff' : 'Show diff'}</span>
            </button>
            {expanded && (
              <div className="mt-1 bg-zinc-900 rounded overflow-hidden max-h-80 overflow-y-auto">
                <DiffView diff={tool.diff} />
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

function ReadToolDisplay({ tool }: { tool: ReadTool }) {
  const fileName = tool.input.file_path.split('/').pop() || tool.input.file_path

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FileSearch}
        label={`Read ${fileName}`}
        status={tool.status}
      />
      <div className="text-xs text-zinc-500 font-mono pl-6">
        {tool.input.file_path}
        {tool.input.offset != null && ` (offset: ${tool.input.offset})`}
        {tool.input.limit != null && ` (limit: ${tool.input.limit})`}
      </div>
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
      />
    </div>
  )
}

function WriteToolDisplay({ tool }: { tool: WriteTool }) {
  const fileName = tool.input.file_path.split('/').pop() || tool.input.file_path

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FileCode}
        label={`Write ${fileName}`}
        status={tool.status}
      />
      <div className="text-xs text-zinc-500 font-mono pl-6">
        {tool.input.file_path}
      </div>
      <CollapsibleOutput
        output={tool.content}
        truncated={tool.content_truncated}
      />
    </div>
  )
}

function GrepToolDisplay({ tool }: { tool: GrepTool }) {
  const isGlob = tool.name === 'Glob'

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={Search}
        label={`${isGlob ? 'Glob' : 'Grep'} ${tool.input.pattern}`}
        status={tool.status}
      />
      {tool.input.path && (
        <div className="text-xs text-zinc-500 font-mono pl-6">
          in {tool.input.path}
        </div>
      )}
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
      />
    </div>
  )
}

function TaskToolDisplay({ tool }: { tool: TaskTool }) {
  return (
    <div className="space-y-1">
      <ToolHeader
        icon={Sparkles}
        label={`Task: ${tool.input.description}`}
        status={tool.status}
        meta={tool.input.subagent_type}
      />
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
      />
    </div>
  )
}

function TodoWriteToolDisplay({ tool }: { tool: TodoWriteTool }) {
  const todos = tool.input.todos || []

  return (
    <div className="space-y-2">
      <ToolHeader icon={ListTodo} label="Todo List" status={tool.status} />
      <div className="pl-6 space-y-1">
        {todos.map((todo, i) => (
          <div
            key={`${i}-${todo.content}`}
            className="flex items-center gap-2 text-xs"
          >
            {todo.status === 'completed' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            ) : todo.status === 'in_progress' ? (
              <CircleDot className="w-3.5 h-3.5 text-blue-500" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-zinc-500" />
            )}
            <span
              className={cn(
                todo.status === 'completed' && 'text-zinc-500 line-through',
                todo.status === 'in_progress' && 'text-blue-400',
                todo.status === 'pending' && 'text-zinc-300',
              )}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GenericToolDisplay({ tool }: { tool: GenericTool }) {
  return (
    <div className="space-y-1">
      <ToolHeader icon={FileText} label={tool.name} status={tool.status} />
      {tool.output && (
        <CollapsibleOutput
          output={tool.output}
          truncated={tool.output_truncated || false}
        />
      )}
    </div>
  )
}

export function ToolCallDisplay({ tool }: ToolCallDisplayProps) {
  switch (tool.name) {
    case 'Bash':
      return <BashToolDisplay tool={tool as BashTool} />
    case 'Edit':
      return <EditToolDisplay tool={tool as EditTool} />
    case 'Read':
      return <ReadToolDisplay tool={tool as ReadTool} />
    case 'Write':
      return <WriteToolDisplay tool={tool as WriteTool} />
    case 'Grep':
    case 'Glob':
      return <GrepToolDisplay tool={tool as GrepTool} />
    case 'Task':
      return <TaskToolDisplay tool={tool as TaskTool} />
    case 'TodoWrite':
      return <TodoWriteToolDisplay tool={tool as TodoWriteTool} />
    default:
      return <GenericToolDisplay tool={tool as GenericTool} />
  }
}
