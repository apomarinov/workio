import type { ShellTemplate } from '@domains/settings/schema'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { useSettings } from '@/hooks/useSettings'
import { toastError } from '@/lib/toastError'

export function ShellTemplateSetting() {
  const { settings, updateSettings } = useSettings()
  const templates = settings?.shell_templates ?? []
  const [deleteTarget, setDeleteTarget] = useState<ShellTemplate | null>(null)

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await updateSettings({
        shell_templates: templates.filter((t) => t.id !== deleteTarget.id),
      })
    } catch (err) {
      toastError(err, 'Failed to delete template')
    }
    setDeleteTarget(null)
  }

  return (
    <>
      <div className="space-y-1 w-full">
        {templates.length === 0 ? (
          <div className="text-xs text-muted-foreground/60 italic">
            No templates
          </div>
        ) : (
          templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="flex items-center justify-between gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{tmpl.name}</div>
                <div className="text-xs text-muted-foreground">
                  {tmpl.entries.length} shell{tmpl.entries.length !== 1 && 's'}
                  {tmpl.layout && ' · split layout'}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('open-template-modal', {
                        detail: { template: tmpl },
                      }),
                    )
                  }
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(tmpl)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent('open-template-modal'))
          }
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer mt-2"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Template
        </button>
      </div>
      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Template"
        message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
