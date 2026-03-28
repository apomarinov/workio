import type { HiddenGHAuthor } from '@domains/settings/schema'
import { Trash2 } from 'lucide-react'
import { useSettingsView } from '../SettingsViewContext'

export function createAuthorFilterSetting(path: string) {
  return function AuthorFilterSetting() {
    const { getFormValue, setFormValue } = useSettingsView()
    const authors = (getFormValue(path) as HiddenGHAuthor[] | undefined) ?? []

    const remove = (index: number) => {
      setFormValue(
        path,
        authors.filter((_, i) => i !== index),
      )
    }

    if (authors.length === 0) {
      return <div className="text-xs text-muted-foreground/60 italic">None</div>
    }

    return (
      <div className="space-y-1 w-full">
        {authors.map((entry, i) => (
          <div
            key={`${entry.repo}-${entry.author}`}
            className="flex items-center justify-between gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg text-sm"
          >
            <div className="min-w-0 truncate">
              <span className="text-muted-foreground">{entry.repo}</span>
              <span className="mx-1 text-muted-foreground/40">/</span>
              <span>{entry.author}</span>
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
}
