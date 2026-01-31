import {
  AlignLeft,
  Brain,
  Code,
  TerminalSquare,
  Type,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_FONT_SIZE } from '../constants'
import { useSettings } from '../hooks/useSettings'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { settings, updateSettings } = useSettings()
  const [defaultShell, setDefaultShell] = useState('')
  const [fontSize, setFontSize] = useState<string>('')
  const [showThinking, setShowThinking] = useState(false)
  const [showTools, setShowTools] = useState(true)
  const [showToolOutput, setShowToolOutput] = useState(false)
  const [messageLineClamp, setMessageLineClamp] = useState<string>('5')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) {
      setDefaultShell(settings.default_shell)
      setFontSize(settings.font_size?.toString() ?? '')
      setShowThinking(settings.show_thinking)
      setShowTools(settings.show_tools)
      setShowToolOutput(settings.show_tool_output)
      setMessageLineClamp(settings.message_line_clamp.toString())
    }
  }, [settings])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!defaultShell.trim()) return

    setSaving(true)
    try {
      const fontSizeValue = fontSize.trim() ? parseInt(fontSize, 10) : null
      const lineClampValue = parseInt(messageLineClamp, 10) || 5
      await updateSettings({
        default_shell: defaultShell.trim(),
        font_size: fontSizeValue,
        show_thinking: showThinking,
        show_tools: showTools,
        show_tool_output: showTools ? showToolOutput : false,
        message_line_clamp: lineClampValue,
      })
      toast.success('Settings saved')
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save settings',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-sidebar">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-2">
            <label htmlFor="default_shell" className="text-sm font-medium">
              Default Shell <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <TerminalSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="default_shell"
                type="text"
                value={defaultShell}
                onChange={(e) => setDefaultShell(e.target.value)}
                placeholder="/bin/bash"
                className="pl-10"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The shell must exist on the system
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="font_size" className="text-sm font-medium">
              Terminal Font Size
            </label>
            <div className="relative">
              <Type className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="font_size"
                type="number"
                min={8}
                max={32}
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
                placeholder={DEFAULT_FONT_SIZE.toString()}
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Font size in pixels (8-32). Default: {DEFAULT_FONT_SIZE}
            </p>
          </div>

          <div className="space-y-2]">
            <label htmlFor="message_line_clamp" className="text-sm font-medium">
              Message Preview Lines
            </label>
            <div className="relative">
              <AlignLeft className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="message_line_clamp"
                type="number"
                min={1}
                max={20}
                value={messageLineClamp}
                onChange={(e) => setMessageLineClamp(e.target.value)}
                placeholder="5"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Lines to show in session list message preview (1-20). Default: 5
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t-[1px] mt-1 py-3">
            <span className='font-semibold'>Claude Chat</span>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-muted-foreground" />
                <label htmlFor="show_thinking" className="text-sm font-medium">
                  Thinking
                </label>
              </div>
              <Switch
                id="show_thinking"
                checked={showThinking}
                onCheckedChange={setShowThinking}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-muted-foreground" />
                <label htmlFor="show_tools" className="text-sm font-medium">
                  Tools
                </label>
              </div>
              <Switch
                id="show_tools"
                checked={showTools}
                onCheckedChange={setShowTools}
              />
            </div>

            {showTools && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-muted-foreground" />
                  <label
                    htmlFor="show_tool_output"
                    className="text-sm font-medium"
                  >
                    Tool Output
                  </label>
                </div>
                <Switch
                  id="show_tool_output"
                  checked={showToolOutput}
                  onCheckedChange={setShowToolOutput}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !defaultShell.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
