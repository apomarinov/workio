import type { HiddenPR } from '@domains/settings/schema'
import { Trash2 } from 'lucide-react'
import { useSettingsView } from '../SettingsViewContext'

export function HiddenPRsSetting() {
  const { getFormValue, setFormValue } = useSettingsView()
  const prs = (getFormValue('hidden_prs') as HiddenPR[] | undefined) ?? []

  const remove = (index: number) => {
    setFormValue(
      'hidden_prs',
      prs.filter((_, i) => i !== index),
    )
  }

  if (prs.length === 0) {
    return <div className="text-xs text-muted-foreground/60 italic">None</div>
  }

  return (
    <div className="space-y-1 w-full">
      {prs.map((pr, i) => (
        <div
          key={`${pr.repo}-${pr.prNumber}`}
          className="flex items-center justify-between gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg text-sm"
        >
          <div className="min-w-0 truncate">
            <span className="text-muted-foreground">{pr.repo}</span>
            <span className="mx-1 text-muted-foreground/40">#</span>
            <span>{pr.prNumber}</span>
            <span className="ml-2 text-muted-foreground text-xs">
              {pr.title}
            </span>
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
