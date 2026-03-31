import { useEffect } from 'react'
import { isRedactionEnabled, redactText } from '@/lib/redact'

/**
 * Watches the entire DOM for text nodes and replaces words based on the
 * redaction config. Skips script/style/textarea/input elements and
 * xterm containers (terminal output is handled separately).
 */
export function useDomRedaction() {
  useEffect(() => {
    if (!isRedactionEnabled()) return

    const SKIP_TAGS = new Set([
      'SCRIPT',
      'STYLE',
      'TEXTAREA',
      'INPUT',
      'NOSCRIPT',
    ])

    function shouldSkip(node: Node): boolean {
      if (!node.parentElement) return true
      if (SKIP_TAGS.has(node.parentElement.tagName)) return true
      // Skip xterm — terminal output is redacted at the data level
      if (node.parentElement.closest('.xterm')) return true
      return false
    }

    function processNode(node: Text) {
      if (shouldSkip(node)) return
      const original = node.textContent
      if (!original) return
      const replaced = redactText(original)
      if (replaced !== original) {
        node.textContent = replaced
      }
    }

    // Process all existing text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    )
    while (walker.nextNode()) {
      processNode(walker.currentNode as Text)
    }

    // Watch for new/changed text nodes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'characterData' &&
          mutation.target.nodeType === Node.TEXT_NODE
        ) {
          processNode(mutation.target as Text)
        }
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              processNode(node as Text)
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const inner = document.createTreeWalker(
                node,
                NodeFilter.SHOW_TEXT,
              )
              while (inner.nextNode()) {
                processNode(inner.currentNode as Text)
              }
            }
          }
        }
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => observer.disconnect()
  }, [])
}
