import type { HiddenGHAuthor } from '@domains/settings/schema'
import { Github, Trash2 } from 'lucide-react'
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

    const grouped = new Map<
      string,
      { author: string; originalIndex: number }[]
    >()
    for (let i = 0; i < authors.length; i++) {
      const entry = authors[i]
      const list = grouped.get(entry.repo) ?? []
      list.push({ author: entry.author, originalIndex: i })
      grouped.set(entry.repo, list)
    }
    const entries = Array.from(grouped.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )

    return (
      <div className="space-y-2 w-full">
        {entries.map(([repo, groupAuthors]) => (
          <div key={repo} className="space-y-1">
            <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
              <Github className="w-3 h-3" />
              {repo}
            </div>
            {groupAuthors.map(({ author, originalIndex }) => (
              <div
                key={`${repo}-${author}`}
                className="flex items-center justify-between gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg text-sm"
              >
                <div className="min-w-0 truncate">{author}</div>
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
}
