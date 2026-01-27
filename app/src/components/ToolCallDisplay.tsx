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
  Maximize2,
  Search,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useSettings } from '../hooks/useSettings'
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
    <CheckCircle2 className="w-3.5 h-3.5 min-w-3.5 min-h-3.5 text-green-500" />
  ) : (
    <XCircle className="w-3.5 h-3.5 min-w-3.5 min-h-3.5 text-red-500" />
  )
}

function ToolHeader({
  icon: Icon,
  label,
  status,
  meta,
  onExpand,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  status: 'success' | 'error'
  meta?: React.ReactNode
  onExpand?: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusDot status={status} />
      <Icon className="w-4 h-4 min-w-4 min-h-4 text-zinc-400" />
      <span className="font-mono text-zinc-300 flex-1">{label}</span>
      {meta && <span className="text-xs text-zinc-500">{meta}</span>}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="p-1 cursor-pointer hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Expand to fullscreen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function getToolIcon(name: string) {
  switch (name) {
    case 'Bash':
      return Terminal
    case 'Edit':
      return FilePen
    case 'Read':
      return FileSearch
    case 'Write':
      return FileCode
    case 'Grep':
    case 'Glob':
      return Search
    case 'Task':
      return Sparkles
    case 'TodoWrite':
      return ListTodo
    default:
      return FileText
  }
}

function getToolTitle(tool: ToolData): string {
  switch (tool.name) {
    case 'Bash':
      return `$ ${(tool as BashTool).input.command}`
    case 'Edit':
      return `Edit: ${(tool as EditTool).input.file_path}`
    case 'Read':
      return `Read: ${(tool as ReadTool).input.file_path}`
    case 'Write':
      return `Write: ${(tool as WriteTool).input.file_path}`
    case 'Grep':
    case 'Glob':
      return `${tool.name}: ${(tool as GrepTool).input.pattern}`
    case 'Task':
      return `Task: ${(tool as TaskTool).input.description}`
    case 'TodoWrite':
      return 'Todo List'
    default:
      return tool.name
  }
}

function ToolMetadata({ tool }: { tool: ToolData }) {
  switch (tool.name) {
    case 'Bash': {
      const t = tool as BashTool
      return t.input.description ? (
        <div className="text-sm text-zinc-400 mt-1">{t.input.description}</div>
      ) : null
    }
    case 'Edit': {
      const t = tool as EditTool
      return (
        <div className="flex items-center gap-4 text-sm text-zinc-400 mt-1">
          <span className="font-mono">{t.input.file_path}</span>
          <span className="text-green-400 mr-1">+{t.lines_added}</span>
          <span className="text-red-400">-{t.lines_removed}</span>
        </div>
      )
    }
    case 'Read': {
      const t = tool as ReadTool
      return (
        <div className="text-sm text-zinc-400 font-mono mt-1">
          {t.input.file_path}
          {t.input.offset != null && ` (offset: ${t.input.offset})`}
          {t.input.limit != null && ` (limit: ${t.input.limit})`}
        </div>
      )
    }
    case 'Write': {
      const t = tool as WriteTool
      return (
        <div className="text-sm text-zinc-400 font-mono mt-1">
          {t.input.file_path}
        </div>
      )
    }
    case 'Grep':
    case 'Glob': {
      const t = tool as GrepTool
      return t.input.path ? (
        <div className="text-sm text-zinc-400 font-mono mt-1">
          in {t.input.path}
        </div>
      ) : null
    }
    case 'Task': {
      const t = tool as TaskTool
      return (
        <div className="text-sm text-zinc-400 mt-1">
          Agent: {t.input.subagent_type}
        </div>
      )
    }
    default:
      return null
  }
}

function FullscreenToolOutput({ tool }: { tool: ToolData }) {
  switch (tool.name) {
    case 'Bash': {
      const t = tool as BashTool
      return (
        <div className="space-y-4">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Command</div>
            <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
              {t.input.command}
            </pre>
          </div>
          {t.output && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">
                Output {t.output_truncated && '(truncated)'}
              </div>
              <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
                {t.output}
              </pre>
            </div>
          )}
        </div>
      )
    }
    case 'Edit': {
      const t = tool as EditTool
      if (t.diff_truncated) {
        return <p className="text-zinc-500">[Diff too large to display]</p>
      }
      return t.diff ? <DiffView diff={t.diff} /> : null
    }
    case 'Read': {
      const t = tool as ReadTool
      return t.output ? (
        <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
          {t.output}
        </pre>
      ) : null
    }
    case 'Write': {
      const t = tool as WriteTool
      return t.content ? (
        <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
          {t.content}
        </pre>
      ) : null
    }
    case 'Grep':
    case 'Glob': {
      const t = tool as GrepTool
      return t.output ? (
        <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
          {t.output}
        </pre>
      ) : null
    }
    case 'Task': {
      const t = tool as TaskTool
      return t.output ? (
        <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
          {t.output}
        </pre>
      ) : null
    }
    case 'TodoWrite': {
      const t = tool as TodoWriteTool
      const todos = t.input.todos || []
      return (
        <div className="space-y-2">
          {todos.map((todo, i) => (
            <div
              key={`${i}-${todo.content}`}
              className="flex items-center gap-3"
            >
              {todo.status === 'completed' ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : todo.status === 'in_progress' ? (
                <CircleDot className="w-4 h-4 text-blue-500" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-500" />
              )}
              <span
                className={cn(
                  'text-sm',
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
      )
    }
    default: {
      const t = tool as GenericTool
      return t.output ? (
        <pre className="p-3 bg-zinc-950 rounded text-sm text-zinc-300 whitespace-pre-wrap">
          {t.output}
        </pre>
      ) : null
    }
  }
}

function FullscreenToolDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: ToolData
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const Icon = getToolIcon(tool.name)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col sm:max-w-[95vw]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <StatusDot status={tool.status} />
            <Icon className="w-4 h-4 text-zinc-400" />
            <span>{getToolTitle(tool)}</span>
          </DialogTitle>
          <ToolMetadata tool={tool} />
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-zinc-900 rounded p-4 min-h-0">
          <FullscreenToolOutput tool={tool} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CollapsibleOutput({
  output,
  truncated,
  status,
}: {
  output: string
  truncated: boolean
  status?: 'success' | 'error'
}) {
  const { settings } = useSettings()
  const [isExpanded, setIsExpanded] = useState<boolean | null>(null)

  const expanded = isExpanded ?? (status === 'error' ? true : settings?.show_tool_output ?? false)
  const hasOutput = output && output.trim().length > 0

  if (!hasOutput) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!expanded)}
        className="flex cursor-pointer items-center gap-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
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

function BashToolDisplay({
  tool,
  onExpand,
}: {
  tool: BashTool
  onExpand: () => void
}) {
  const command =
    tool.input.command.length > 500
      ? `${tool.input.command.slice(0, 500)}...`
      : tool.input.command

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={Terminal}
        label={command}
        status={tool.status}
        meta={tool.input.description}
        onExpand={onExpand}
      />
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
        status={tool.status}
      />
    </div>
  )
}

function EditToolDisplay({
  tool,
  onExpand,
}: {
  tool: EditTool
  onExpand: () => void
}) {
  const { settings } = useSettings()
  const [isExpanded, setIsExpanded] = useState<boolean | null>(null)
  const expanded = isExpanded ?? (tool.status === 'error' ? true : settings?.show_tool_output ?? false)
  const fileName = tool.input.file_path.split('/').pop() || tool.input.file_path

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FilePen}
        label={`Update ${fileName}`}
        status={tool.status}
        meta={
          <>
            <span className="text-green-400 mr-1">+{tool.lines_added}</span>
            <span className="text-red-400">-{tool.lines_removed}</span>
          </>
        }
        onExpand={onExpand}
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
              onClick={() => setIsExpanded(!expanded)}
              className="flex cursor-pointer items-center gap-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
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

function ReadToolDisplay({
  tool,
  onExpand,
}: {
  tool: ReadTool
  onExpand: () => void
}) {
  const fileName = tool.input.file_path.split('/').pop() || tool.input.file_path

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FileSearch}
        label={`Read ${fileName}`}
        status={tool.status}
        onExpand={onExpand}
      />
      <div className="text-xs text-zinc-500 font-mono pl-6">
        {tool.input.file_path}
        {tool.input.offset != null && ` (offset: ${tool.input.offset})`}
        {tool.input.limit != null && ` (limit: ${tool.input.limit})`}
      </div>
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
        status={tool.status}
      />
    </div>
  )
}

function WriteToolDisplay({
  tool,
  onExpand,
}: {
  tool: WriteTool
  onExpand: () => void
}) {
  const fileName = tool.input.file_path.split('/').pop() || tool.input.file_path

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FileCode}
        label={`Write ${fileName}`}
        status={tool.status}
        onExpand={onExpand}
      />
      <div className="text-xs text-zinc-500 font-mono pl-6">
        {tool.input.file_path}
      </div>
      <CollapsibleOutput
        output={tool.content}
        truncated={tool.content_truncated}
        status={tool.status}
      />
    </div>
  )
}

function GrepToolDisplay({
  tool,
  onExpand,
}: {
  tool: GrepTool
  onExpand: () => void
}) {
  const isGlob = tool.name === 'Glob'

  return (
    <div className="space-y-1">
      <ToolHeader
        icon={Search}
        label={`${isGlob ? 'Glob' : 'Grep'} ${tool.input.pattern}`}
        status={tool.status}
        onExpand={onExpand}
      />
      {tool.input.path && (
        <div className="text-xs text-zinc-500 font-mono pl-6">
          in {tool.input.path}
        </div>
      )}
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
        status={tool.status}
      />
    </div>
  )
}

function TaskToolDisplay({
  tool,
  onExpand,
}: {
  tool: TaskTool
  onExpand: () => void
}) {
  return (
    <div className="space-y-1">
      <ToolHeader
        icon={Sparkles}
        label={`Task: ${tool.input.description}`}
        status={tool.status}
        meta={tool.input.subagent_type}
        onExpand={onExpand}
      />
      <CollapsibleOutput
        output={tool.output}
        truncated={tool.output_truncated}
        status={tool.status}
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

function GenericToolDisplay({
  tool,
  onExpand,
}: {
  tool: GenericTool
  onExpand: () => void
}) {
  return (
    <div className="space-y-1">
      <ToolHeader
        icon={FileText}
        label={tool.name}
        status={tool.status}
        onExpand={onExpand}
      />
      {tool.output && (
        <CollapsibleOutput
          output={tool.output}
          truncated={tool.output_truncated || false}
          status={tool.status}
        />
      )}
    </div>
  )
}

export function ToolCallDisplay({ tool }: ToolCallDisplayProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const onExpand = () => setIsFullscreen(true)

  return (
    <>
      {tool.name === 'Bash' && (
        <BashToolDisplay tool={tool as BashTool} onExpand={onExpand} />
      )}
      {tool.name === 'Edit' && (
        <EditToolDisplay tool={tool as EditTool} onExpand={onExpand} />
      )}
      {tool.name === 'Read' && (
        <ReadToolDisplay tool={tool as ReadTool} onExpand={onExpand} />
      )}
      {tool.name === 'Write' && (
        <WriteToolDisplay tool={tool as WriteTool} onExpand={onExpand} />
      )}
      {(tool.name === 'Grep' || tool.name === 'Glob') && (
        <GrepToolDisplay tool={tool as GrepTool} onExpand={onExpand} />
      )}
      {tool.name === 'Task' && (
        <TaskToolDisplay tool={tool as TaskTool} onExpand={onExpand} />
      )}
      {tool.name === 'TodoWrite' && (
        <TodoWriteToolDisplay tool={tool as TodoWriteTool} />
      )}
      {![
        'Bash',
        'Edit',
        'Read',
        'Write',
        'Grep',
        'Glob',
        'Task',
        'TodoWrite',
      ].includes(tool.name) && (
          <GenericToolDisplay tool={tool as GenericTool} onExpand={onExpand} />
        )}

      <FullscreenToolDialog
        tool={tool}
        open={isFullscreen}
        onOpenChange={setIsFullscreen}
      />
    </>
  )
}
