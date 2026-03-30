import type { HiddenPR } from '@domains/settings/schema'
import { Github, Trash2 } from 'lucide-react'
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

  const grouped = new Map<string, { pr: HiddenPR; originalIndex: number }[]>()
  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i]
    const list = grouped.get(pr.repo) ?? []
    list.push({ pr, originalIndex: i })
    grouped.set(pr.repo, list)
  }
  const entries = Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )

  return (
    <div className="space-y-2 w-full">
      {entries.map(([repo, groupPRs]) => (
        <div key={repo} className="space-y-1">
          <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <Github className="w-3 h-3" />
            {repo}
          </div>
          {groupPRs.map(({ pr, originalIndex }) => (
            <div
              key={`${pr.repo}-${pr.prNumber}`}
              className="flex items-center justify-between gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg text-sm"
            >
              <div className="min-w-0 truncate">
                <span className="text-muted-foreground">#</span>
                <span className="font-medium">{pr.prNumber}</span>
                <span className="ml-2 text-muted-foreground text-xs">
                  {pr.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(originalIndex)}
                className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
