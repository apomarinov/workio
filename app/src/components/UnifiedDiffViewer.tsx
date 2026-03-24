import { ColorSchemeType } from 'diff2html/lib-esm/types'
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui-slim'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc'

const UNIFIED_D2H_CONFIG = {
  outputFormat: 'line-by-line' as const,
  drawFileList: false,
  matching: 'words' as const,
  diffStyle: 'word' as const,
  colorScheme: ColorSchemeType.DARK,
  highlight: true,
  stickyFileHeaders: true,
  fileContentToggle: false,
  fileListToggle: false,
  smartSelection: true,
}

interface UnifiedDiffViewerProps {
  terminalId: number
  base?: string
  scrollToFile?: string | null
  onScrollComplete?: () => void
}

export function UnifiedDiffViewer({
  terminalId,
  base,
  scrollToFile,
  onScrollComplete,
}: UnifiedDiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevDiffRef = useRef<string>('')

  const { data, isLoading } = trpc.git.diff.fileDiff.useQuery(
    { terminalId, base: base ?? undefined },
    { placeholderData: (prev) => prev },
  )

  // Render diff2html when diff changes
  useEffect(() => {
    const el = containerRef.current
    if (!el || !data?.diff) {
      if (el) el.innerHTML = ''
      return
    }
    if (data.diff === prevDiffRef.current) return
    prevDiffRef.current = data.diff

    const ui = new Diff2HtmlUI(el, data.diff, UNIFIED_D2H_CONFIG)
    ui.draw()
    ui.highlightCode()

    // Set data-file-path attributes and add collapse toggle on each file wrapper
    const wrappers = el.querySelectorAll('.d2h-file-wrapper')
    for (const wrapper of wrappers) {
      const nameEl = wrapper.querySelector('.d2h-file-name')
      if (nameEl) {
        const path = nameEl.textContent?.trim()
        if (path) wrapper.setAttribute('data-file-path', path)
      }

      const header = wrapper.querySelector(
        '.d2h-file-header',
      ) as HTMLElement | null
      if (!header) continue

      // Add chevron indicator
      const chevron = document.createElement('span')
      chevron.className = 'd2h-collapse-chevron'
      chevron.textContent = '\u25B8' // ▸
      header.prepend(chevron)

      header.style.cursor = 'pointer'
      header.addEventListener('click', () => {
        const diff = wrapper.querySelector(
          '.d2h-file-diff',
        ) as HTMLElement | null
        if (!diff) return
        const collapsed = diff.style.display === 'none'
        diff.style.display = collapsed ? '' : 'none'
        chevron.classList.toggle('collapsed', !collapsed)
      })
    }
  }, [data?.diff])

  // Scroll to file when scrollToFile changes
  useEffect(() => {
    if (!scrollToFile || !containerRef.current) return
    const wrapper = containerRef.current.querySelector(
      `[data-file-path="${CSS.escape(scrollToFile)}"]`,
    )
    if (wrapper) {
      // Expand if collapsed
      const diff = wrapper.querySelector('.d2h-file-diff') as HTMLElement | null
      if (diff?.style.display === 'none') {
        diff.style.display = ''
        const chevron = wrapper.querySelector('.d2h-collapse-chevron')
        chevron?.classList.remove('collapsed')
      }
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    onScrollComplete?.()
  }, [scrollToFile])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading diff...
      </div>
    )
  }

  if (!data?.diff) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        No changes
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="unified-diff-view h-full overflow-y-auto"
    />
  )
}
