import { lazy, memo, Suspense } from 'react'

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'))

interface MarkdownContentProps {
  content: string
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
}: MarkdownContentProps) {
  return (
    <Suspense fallback={<span>{content}</span>}>
      <MarkdownRenderer content={content} />
    </Suspense>
  )
})
