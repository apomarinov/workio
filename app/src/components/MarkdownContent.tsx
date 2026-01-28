import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
  content: string
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const codeString = String(children).replace(/\n$/, '')

          if (match) {
            return (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                customStyle={{
                  margin: '0.5rem 0',
                  borderRadius: '0.375rem',
                  fontSize: '0.75rem',
                }}
              >
                {codeString}
              </SyntaxHighlighter>
            )
          }

          return (
            <code
              className="bg-zinc-900 px-1.5 py-0.5 rounded text-xs"
              {...props}
            >
              {children}
            </code>
          )
        },
        pre({ children }) {
          // Just return children since SyntaxHighlighter handles its own wrapper
          return <>{children}</>
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>
        },
        ul({ children }) {
          return (
            <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
          )
        },
        ol({ children }) {
          return (
            <ol className="list-decimal list-inside mb-2 space-y-1">
              {children}
            </ol>
          )
        },
        li({ children }) {
          return <li>{children}</li>
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className="text-blue-400 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          )
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-zinc-600 pl-3 italic text-zinc-400 mb-2">
              {children}
            </blockquote>
          )
        },
        h1({ children }) {
          return <h1 className="text-lg font-bold mb-2">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-base font-bold mb-2">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold mb-1">{children}</h3>
        },
        strong({ children }) {
          return <strong className="font-semibold">{children}</strong>
        },
        em({ children }) {
          return <em className="italic">{children}</em>
        },
        hr() {
          return <hr className="border-zinc-700 my-3" />
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto mb-2">
              <table className="min-w-full border-collapse border border-zinc-700 text-sm">
                {children}
              </table>
            </div>
          )
        },
        thead({ children }) {
          return <thead className="bg-zinc-800">{children}</thead>
        },
        tbody({ children }) {
          return <tbody>{children}</tbody>
        },
        tr({ children }) {
          return <tr className="border-b border-zinc-700">{children}</tr>
        },
        th({ children }) {
          return (
            <th className="border border-zinc-700 px-3 py-1.5 text-left font-semibold">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-zinc-700 px-3 py-1.5">{children}</td>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
