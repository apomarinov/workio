import { Plus } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { AppKeyboardShortcuts } from './components/AppKeyboardShortcuts'
import { AppModals } from './components/AppModals'
import { CommandPalette } from './components/command-palette'
import { DesktopLayout } from './components/DesktopLayout'
import { MobileLayout } from './components/MobileLayout'
import { PinnedSessionsPip } from './components/PinnedSessionsPip'
import { ShellTabs } from './components/ShellTabs'
import { Terminal } from './components/Terminal'

const StatusBar = lazy(() =>
  import('./components/StatusBar').then((m) => ({ default: m.StatusBar })),
)
const SessionChat = lazy(() =>
  import('./components/SessionChat').then((m) => ({ default: m.SessionChat })),
)

import { DocumentPipProvider } from './context/DocumentPipContext'
import { GitHubProvider } from './context/GitHubContext'
import { NotificationDataProvider } from './context/NotificationDataContext'
import { ProcessProvider } from './context/ProcessContext'
import { SessionProvider, useSessionContext } from './context/SessionContext'
import {
  useWorkspaceContext,
  WorkspaceProvider,
} from './context/WorkspaceContext'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useIsMobile } from './hooks/useMediaQuery'
import { useMountedShells } from './hooks/useMountedShells'
import { useNotificationSubscriptions } from './hooks/useNotificationSubscriptions'
import { useSettings } from './hooks/useSettings'
import { useShellActions } from './hooks/useShellActions'
import { useSleepWakeRevalidation } from './hooks/useSleepWakeRevalidation'
import { cn } from './lib/utils'
import { DEFAULT_STATUS_BAR } from './types'

function AppContent() {
  const {
    terminals,
    loading,
    activeTerminal,
    selectTerminal,
    activeShells,
    setShell,
  } = useWorkspaceContext()
  const { activeSessionId, selectSession, sessions } = useSessionContext()
  const { settings } = useSettings()
  const [tabBar] = useLocalStorage('shell-tabs-bar', true)
  const [tabsTop] = useLocalStorage('shell-tabs-top', true)
  const isMobile = useIsMobile()
  const mountedShells = useMountedShells()
  const { handleCreateShell, handleRenameShell } = useShellActions()
  useNotificationSubscriptions()
  useSleepWakeRevalidation()

  // Auto-select first active session when there are no terminals
  useEffect(() => {
    if (
      !loading &&
      terminals.length === 0 &&
      sessions.length > 0 &&
      !activeSessionId
    ) {
      const activeSession = sessions.find(
        (s) => s.status === 'active' || s.status === 'permission_needed',
      )
      const sessionToSelect = activeSession || sessions[0]
      if (sessionToSelect) {
        selectSession(sessionToSelect.session_id)
      }
    }
  }, [loading, terminals.length, sessions, activeSessionId, selectSession])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-zinc-400">Loading...</p>
      </div>
    )
  }

  const effectiveTabsTop = isMobile ? false : tabsTop

  const mainContent = (
    <div className="h-full relative">
      {activeSessionId ? (
        <div className="absolute inset-0 z-20">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center bg-zinc-950 text-zinc-400">
                Loading...
              </div>
            }
          >
            <SessionChat hideAvatars={isMobile} />
          </Suspense>
        </div>
      ) : terminals.length === 0 ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#1a1a1a]">
          <Button
            variant="outline"
            size="lg"
            className="gap-2 text-base"
            onClick={() =>
              window.dispatchEvent(new Event('open-create-terminal'))
            }
          >
            <Plus className="w-5 h-5" />
            Create New Project
          </Button>
        </div>
      ) : null}
      {terminals.map((t) => {
        const activeShellId =
          activeShells[t.id] ??
          t.shells.find((s) => s.name === 'main')?.id ??
          t.shells[0]?.id
        const isTermVisible = !activeSessionId && t.id === activeTerminal?.id
        const statusBarConfig = settings?.statusBar ?? DEFAULT_STATUS_BAR
        const showStatusBar = statusBarConfig.enabled && !isMobile
        const statusBarOnTop = statusBarConfig.onTop

        return (
          <div
            key={t.id}
            className={cn(
              'absolute inset-0 flex bg-[#1a1a1a]',
              effectiveTabsTop ? 'flex-col' : 'flex-col-reverse',
              !isTermVisible && 'invisible',
            )}
          >
            {showStatusBar &&
              statusBarOnTop === effectiveTabsTop &&
              activeShellId != null && (
                <Suspense fallback={<div className="w-full h-[29px]" />}>
                  <StatusBar position={statusBarOnTop ? 'top' : 'bottom'} />
                </Suspense>
              )}
            {tabBar && activeShellId != null && !isMobile && (
              <ShellTabs
                terminal={t}
                activeShellId={activeShellId}
                onSelectShell={(shellId) => {
                  selectTerminal(t.id)
                  setShell(t.id, shellId)
                }}
                onCreateShell={() => handleCreateShell(t.id)}
                onRenameShell={handleRenameShell}
                position={effectiveTabsTop ? 'top' : 'bottom'}
                className="pr-2 bg-[#1a1a1a]"
              />
            )}
            <div className="relative flex-1 min-h-0">
              {t.shells.map((shell) => {
                if (!mountedShells.has(shell.id)) return null
                return (
                  <Terminal
                    key={shell.id}
                    terminalId={t.id}
                    shellId={shell.id}
                    isVisible={isTermVisible && shell.id === activeShellId}
                  />
                )
              })}
            </div>
            {showStatusBar &&
              statusBarOnTop !== effectiveTabsTop &&
              activeShellId != null && (
                <Suspense fallback={<div className="w-full h-[29px]" />}>
                  <StatusBar position={statusBarOnTop ? 'top' : 'bottom'} />
                </Suspense>
              )}
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      {isMobile ? (
        <MobileLayout>{mainContent}</MobileLayout>
      ) : (
        <DesktopLayout>{mainContent}</DesktopLayout>
      )}
      <Toaster />
      <CommandPalette />
      <PinnedSessionsPip />
      <AppModals />
      <AppKeyboardShortcuts />
    </>
  )
}

function App() {
  return (
    <DocumentPipProvider>
      <WorkspaceProvider>
        <ProcessProvider>
          <GitHubProvider>
            <NotificationDataProvider>
              <SessionProvider>
                <AppContent />
              </SessionProvider>
            </NotificationDataProvider>
          </GitHubProvider>
        </ProcessProvider>
      </WorkspaceProvider>
    </DocumentPipProvider>
  )
}

export default App
