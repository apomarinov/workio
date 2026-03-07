import { ColorSchemeType } from 'diff2html/lib-esm/types'
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { getAllFilesDiff } from '@/lib/api'

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

  const { data, isLoading } = useSWR(
    ['all-files-diff', terminalId, base ?? ''],
    async ([, tid, b]) => {
      return await getAllFilesDiff(tid as number, (b as string) || undefined)
    },
    { revalidateOnFocus: false, keepPreviousData: true },
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

    // Set data-file-path attributes on each file wrapper
    const wrappers = el.querySelectorAll('.d2h-file-wrapper')
    for (const wrapper of wrappers) {
      const nameEl = wrapper.querySelector('.d2h-file-name')
      if (nameEl) {
        const path = nameEl.textContent?.trim()
        if (path) wrapper.setAttribute('data-file-path', path)
      }
    }
  }, [data?.diff])

  // Scroll to file when scrollToFile changes
  useEffect(() => {
    if (!scrollToFile || !containerRef.current) return
    const wrapper = containerRef.current.querySelector(
      `[data-file-path="${CSS.escape(scrollToFile)}"]`,
    )
    if (wrapper) {
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
