import { TerminalSquare, Type } from 'lucide-react'
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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) {
      setDefaultShell(settings.default_shell)
      setFontSize(settings.font_size?.toString() ?? '')
    }
  }, [settings])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!defaultShell.trim()) return

    setSaving(true)
    try {
      const fontSizeValue = fontSize.trim() ? parseInt(fontSize, 10) : null
      await updateSettings({
        default_shell: defaultShell.trim(),
        font_size: fontSizeValue,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
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
