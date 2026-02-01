import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'

type PipWin = Window & { document: Document }

interface PipWindowInfo {
  window: PipWin
  mutationObserver: MutationObserver
}

interface DocumentPipContextValue {
  window: PipWin | undefined
  requested: boolean
  open: (options: {
    width?: number
    height?: number
    left?: number
    top?: number
    header?: number
    elementId: string
    className?: string
  }) => Promise<void>
  close: (selector: string) => void
  closeAll: () => void
  isSupported: boolean
  isOpen: boolean
  resize: (to: string | { width?: number; height?: number }) => void
  moveTo: (left: number, top: number) => void
  getContainer: (elementId: string) => HTMLDivElement | undefined
}

const DocumentPipContext = createContext<DocumentPipContextValue | undefined>(
  undefined,
)

function syncStylesInto(targetDoc: Document) {
  // 1) Adopted / constructable stylesheets – clone rules into fresh sheets
  if (
    document.adoptedStyleSheets?.length &&
    targetDoc.adoptedStyleSheets !== undefined
  ) {
    try {
      const cloned: CSSStyleSheet[] = []
      for (const sheet of document.adoptedStyleSheets) {
        const copy = new CSSStyleSheet()
        for (const rule of sheet.cssRules) {
          try {
            copy.insertRule(rule.cssText, copy.cssRules.length)
          } catch {
            // Some rules may not be insertable
          }
        }
        cloned.push(copy)
      }
      targetDoc.adoptedStyleSheets = cloned
    } catch (e) {
      console.debug('Could not clone adopted stylesheets:', e)
    }
  }

  // 2) Remove previously-synced elements so we don't duplicate
  for (const old of Array.from(
    targetDoc.head.querySelectorAll('[data-pip-synced]'),
  )) {
    old.remove()
  }

  // 3) Clone every <link rel="stylesheet"> and <style> from the main document
  const srcNodes = Array.from(
    document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
      'link[rel="stylesheet"], style',
    ),
  )
  for (const node of srcNodes) {
    const clone = node.cloneNode(true) as HTMLElement
    clone.setAttribute('data-pip-synced', 'true')
    if (clone.tagName === 'LINK') {
      const ln = clone as HTMLLinkElement
      if (ln.href)
        ln.href = new URL(ln.getAttribute('href')!, location.href).toString()
    }
    targetDoc.head.appendChild(clone)
  }
}

interface DocumentPipProviderProps {
  children: ReactNode
}

export function DocumentPipProvider({ children }: DocumentPipProviderProps) {
  const [pipWindow, setPipWindow] = useState<PipWindowInfo | null>(null)
  const pipWindowRef = useRef<PipWindowInfo | null>(null)
  pipWindowRef.current = pipWindow
  const [isSupported, setIsSupported] = useState(
    typeof window !== 'undefined' && 'documentPictureInPicture' in window,
  )
  const isSupportedRef = useRef<boolean>(isSupported)
  isSupportedRef.current = isSupported
  const [openRequested, setOpenRequested] = useState<boolean>(false)
  const openRequestedRef = useRef<boolean>(false)
  openRequestedRef.current = openRequested
  const [containers, setContainers] = useState<
    {
      width: number
      height: number
      elementId: string
      container: HTMLDivElement
    }[]
  >([])
  const containersRef = useRef<
    {
      width: number
      height: number
      elementId: string
      container: HTMLDivElement
    }[]
  >([])
  containersRef.current = containers

  const open = useCallback(
    async (params: {
      width?: number
      height?: number
      left?: number
      top?: number
      elementId: string
      header?: number
      className?: string
    }) => {
      try {
        // Check if window with this name already exists
        if (pipWindowRef.current) {
          const container =
            pipWindowRef.current.window.document.createElement('div')
          container.id = params.elementId
          container.classList.add('flex', 'flex-grow')
          if (params.className) container.classList.add(params.className)
          pipWindowRef.current.window.document.body.appendChild(container)
          setContainers((prev) => {
            const newList = [
              ...prev,
              {
                width: params.width ?? 200,
                height: (params.height ?? 100) + (params.header ?? 0),
                elementId: params.elementId,
                container,
              },
            ]
            const newWidth = newList.reduce(
              (max, container) => max + container.width,
              0,
            )
            const newHeight = newList.reduce(
              (max, container) => Math.max(max, container.height),
              0,
            )
            pipWindowRef.current!.window.resizeTo(newWidth, newHeight)
            return newList
          })
          return
        }

        if (!('documentPictureInPicture' in window)) {
          setIsSupported(false)
          setOpenRequested(false)
          return
        }

        const dpi: unknown = window.documentPictureInPicture
        if (!dpi || typeof dpi !== 'object' || !('requestWindow' in dpi)) {
          setIsSupported(false)
          setOpenRequested(false)
          return
        }
        setIsSupported(true)

        const casted = dpi as {
          requestWindow: (options: {
            width: number
            height: number
            preferInitialWindowPlacement: boolean
          }) => Promise<PipWin>
        }
        const pipWindow: PipWin = await casted.requestWindow({
          width: params.width ?? 200,
          height: params.height ?? 100,
          preferInitialWindowPlacement: true,
        })
        syncStylesInto(pipWindow.document)

        // Copy classes from the main <html> element (e.g. "dark") so CSS
        // custom-property scopes like `.dark { --sidebar: ... }` apply.
        for (const cls of document.documentElement.classList) {
          pipWindow.document.documentElement.classList.add(cls)
        }

        pipWindow.document.body.style.backgroundColor = '#171717'
        pipWindow.document.body.classList.add('flex', 'w-[100vw]', 'h-[100vh]')

        if (params.left !== undefined && params.top !== undefined) {
          pipWindow.moveTo(params.left, params.top)
        }

        // Re-sync styles on any <head> mutation (new nodes, HMR text updates, etc.)
        let syncTimer: ReturnType<typeof setTimeout> | null = null
        const mo = new MutationObserver(() => {
          if (syncTimer) clearTimeout(syncTimer)
          syncTimer = setTimeout(() => syncStylesInto(pipWindow.document), 50)
        })
        mo.observe(document.head, {
          childList: true,
          subtree: true,
          characterData: true,
        })
        const container = pipWindow.document.createElement('div')
        container.id = params.elementId
        container.classList.add('flex', 'flex-grow')
        if (params.className) container.classList.add(params.className)
        pipWindow.document.body.appendChild(container)
        setContainers((prev) => [
          ...prev,
          {
            width: params.width ?? 200,
            height: params.height ?? 100,
            elementId: params.elementId,
            container,
          },
        ])

        // Clean up when PiP closes
        pipWindow.addEventListener('pagehide', () => {
          mo.disconnect()
          setContainers([])
          setOpenRequested(false)
          setPipWindow(null)
        })

        const windowInfo: PipWindowInfo = {
          window: pipWindow,
          mutationObserver: mo,
        }

        setPipWindow(windowInfo)
      } catch (error) {
        console.error('Error opening window:', error)
        setOpenRequested(false)
      }
    },
    [],
  )

  const closeAll = useCallback(() => {
    setContainers([])
    if (pipWindowRef.current) {
      pipWindowRef.current.mutationObserver.disconnect()
      pipWindowRef.current.window.close()
    }
    setPipWindow(null)
  }, [])

  const resize = useCallback(
    (to: string | { width?: number; height?: number }) => {
      try {
        const windowInfo = pipWindowRef.current
        if (!windowInfo) {
          return
        }
        const element =
          typeof to === 'string' ? document.querySelector(to) : undefined
        const width =
          (typeof to === 'string' ? element?.clientWidth : to.width) ??
          windowInfo.window.innerWidth
        const height =
          (typeof to === 'string' ? element?.clientHeight : to.height) ??
          windowInfo.window.innerHeight
        windowInfo.window.resizeTo(width, height)
      } catch (error) {
        console.error('Error resizing window:', error)
      }
    },
    [],
  )

  const moveTo = useCallback((left: number, top: number) => {
    try {
      const windowInfo = pipWindowRef.current
      if (windowInfo) {
        windowInfo.window.moveTo(left, top)
      }
    } catch (error) {
      console.error('Error moving window:', error)
    }
  }, [])

  const close = useCallback(
    (selector: string) => {
      try {
        setOpenRequested(false)
        setContainers((prev) => {
          const container = prev.find(
            (container) => container.elementId === selector,
          )
          if (container) {
            container.container.remove()
          }
          const newContainers = prev.filter(
            (container) => container.elementId !== selector,
          )
          const windowInfo = pipWindowRef.current
          if (windowInfo) {
            if (newContainers.length === 0) {
              windowInfo.mutationObserver.disconnect()
              windowInfo.window.close()
              setPipWindow(null)
            } else {
              resize({
                width: newContainers.reduce(
                  (max, container) => max + container.width,
                  0,
                ),
                height:
                  newContainers.reduce(
                    (max, container) => max + container.height,
                    0,
                  ) + 40,
              })
            }
          }
          return newContainers
        })
      } catch (error) {
        console.error('Error closing window:', error)
      }
    },
    [resize],
  )

  const value: DocumentPipContextValue = {
    window: pipWindow?.window,
    requested: openRequested,
    open: async (options) => {
      if (!isSupportedRef.current) {
        return
      }
      setOpenRequested(true)
      setTimeout(() => {
        open(options)
      })
    },
    close,
    closeAll,
    isSupported,
    isOpen: Boolean(pipWindow?.window),
    resize,
    moveTo,
    getContainer: (elementId: string) => {
      const container = containersRef.current.find(
        (container) => container.elementId === elementId,
      )
      return container?.container ?? undefined
    },
  }

  return (
    <DocumentPipContext.Provider value={value}>
      {children}
    </DocumentPipContext.Provider>
  )
}

export function useDocumentPip() {
  const context = useContext(DocumentPipContext)
  if (context === undefined) {
    return {
      window: undefined,
      requested: false,
      open: () => Promise.resolve(),
      close: () => {},
      closeAll: () => {},
      isSupported: false,
      isOpen: false,
      resize: () => {},
      moveTo: () => {},
      getContainer: () => undefined,
    }
  }
  return context
}
