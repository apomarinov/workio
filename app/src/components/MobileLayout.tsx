import {
  LayoutGrid,
  Settings,
  Terminal as TerminalNoBorder,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useSessionContext } from '@/context/SessionContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useEdgeSwipe } from '@/hooks/useEdgeSwipe'
import { useSettings } from '@/hooks/useSettings'
import { useShellActions } from '@/hooks/useShellActions'
import { cn } from '@/lib/utils'
import { ShellTabs } from './ShellTabs'
import { Sidebar } from './Sidebar'

const StatusBar = lazy(() =>
  import('./StatusBar').then((m) => ({ default: m.StatusBar })),
)
const MobileKeyboard = lazy(() =>
  import('./MobileKeyboard').then((m) => ({
    default: m.MobileKeyboard,
  })),
)

interface MobileLayoutProps {
  children: React.ReactNode
}

export function MobileLayout({ children }: MobileLayoutProps) {
  const { handleCreateShell, handleRenameShell } = useShellActions()
  const { activeTerminal, activeShells, selectTerminal, setShell } =
    useWorkspaceContext()
  const { activeSessionId } = useSessionContext()
  const { settings } = useSettings()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileKeyboardMode, setMobileKeyboardMode] = useState<
    'hidden' | 'input' | 'actions'
  >('input')
  const mobileInputRef = useRef<HTMLTextAreaElement>(null)
  const [tabBar] = useState(() => {
    try {
      const stored = localStorage.getItem('shell-tabs-bar')
      return stored !== null ? JSON.parse(stored) : true
    } catch {
      return true
    }
  })

  // Edge swipe to open/close mobile sidebar
  const mobileSidebarOpenRef = useRef(mobileSidebarOpen)
  mobileSidebarOpenRef.current = mobileSidebarOpen
  const mobileSidebarRef = useRef<HTMLDivElement>(null)
  useEdgeSwipe({
    enabled: true,
    ref: mobileSidebarRef,
    direction: 'left',
    onSwipeRight: () => {
      if (!mobileSidebarOpenRef.current) setMobileSidebarOpen(true)
    },
    onSwipeLeft: () => {
      if (mobileSidebarOpenRef.current) setMobileSidebarOpen(false)
    },
  })

  // Auto-close mobile sidebar when navigating to a terminal or session
  const prevActiveTerminalId = useRef(activeTerminal?.id)
  const prevActiveSessionId = useRef(activeSessionId)
  useEffect(() => {
    if (
      mobileSidebarOpen &&
      (activeTerminal?.id !== prevActiveTerminalId.current ||
        activeSessionId !== prevActiveSessionId.current)
    ) {
      setMobileSidebarOpen(false)
    }
    prevActiveTerminalId.current = activeTerminal?.id
    prevActiveSessionId.current = activeSessionId
  }, [activeTerminal?.id, activeSessionId, mobileSidebarOpen])

  // Track visual viewport height on mobile so the layout shrinks when the
  // iOS keyboard opens, keeping our bottom bar visible above it.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      root.style.height = `${vv.height}px`
      window.scrollTo(0, 0)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.height = ''
    }
  }, [])

  return (
    <div
      className="flex flex-col bg-[#1a1a1a] overflow-hidden h-full"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Fullscreen terminal */}
      <div className="flex-1 min-h-0">{children}</div>
      {/* Bottom bar: ShellTabs + MobileKeyboard (in flow so it sits above the iOS keyboard) */}
      {activeTerminal &&
        !activeSessionId &&
        (() => {
          const t = activeTerminal
          const activeShellId =
            activeShells[t.id] ??
            t.shells.find((s) => s.name === 'main')?.id ??
            t.shells[0]?.id
          return (
            <div className="flex-shrink-0 bg-zinc-900">
              {tabBar && activeShellId != null && (
                <ShellTabs
                  terminal={t}
                  activeShellId={activeShellId}
                  onSelectShell={(shellId) => {
                    selectTerminal(t.id)
                    setShell(t.id, shellId)
                  }}
                  onCreateShell={() => handleCreateShell(t.id)}
                  onRenameShell={handleRenameShell}
                  position="bottom"
                  className="pr-2 bg-[#1a1a1a]"
                  rightExtra={
                    <div className="flex items-center gap-0.5 max-sm:border-l-[1px] pl-1">
                      {mobileKeyboardMode === 'input' && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent('open-custom-commands', {
                                  detail: { terminalId: t.id },
                                }),
                              )
                            }
                            className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          >
                            <TerminalNoBorder className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setMobileKeyboardMode('actions')}
                            className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          >
                            <LayoutGrid className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {mobileKeyboardMode === 'actions' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              mobileInputRef.current?.focus()
                              setMobileKeyboardMode('input')
                            }}
                            className="flex items-center justify-center h-7 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          >
                            ABC
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              window.dispatchEvent(
                                new Event('mobile-keyboard-customize'),
                              )
                            }
                            className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  }
                />
              )}
              {settings?.statusBar?.enabled && activeShellId != null && (
                <Suspense fallback={<div className="w-full h-[29px]" />}>
                  <StatusBar position="bottom" />
                </Suspense>
              )}
              <Suspense fallback={null}>
                <MobileKeyboard
                  terminalId={t.id}
                  currentRepo={t.git_repo?.repo}
                  mode={mobileKeyboardMode}
                  inputRef={mobileInputRef}
                />
              </Suspense>
            </div>
          )
        })()}
      {/* Sidebar overlay */}
      <div
        className={cn(
          'fixed inset-0 z-50',
          !mobileSidebarOpen && 'pointer-events-none',
        )}
      >
        {/* Backdrop */}
        <div
          className={cn(
            'fixed inset-0 bg-black/50 transition-opacity duration-300',
            mobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
          onClick={() => setMobileSidebarOpen(false)}
        />
        {/* Sidebar panel */}
        <div
          ref={mobileSidebarRef}
          className={cn(
            'fixed inset-y-0 left-0 w-full bg-sidebar transition-transform duration-300 ease-in-out pt-[env(safe-area-inset-top)]',
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar onDismiss={() => setMobileSidebarOpen(false)} />
        </div>
      </div>
    </div>
  )
}
