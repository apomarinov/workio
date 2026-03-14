import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import type { PRCheckStatus } from '../../shared/types'
import { useSessionContext } from '../context/SessionContext'
import { useWorkspaceContext } from '../context/WorkspaceContext'
import { CreateTerminalModal } from './CreateTerminalModal'
import { PortMappingModal } from './PortMappingModal'
import { PRModal } from './PRModal'

const BranchCommitsDialog = lazy(() =>
  import('./dialogs/BranchCommitsDialog').then((m) => ({
    default: m.BranchCommitsDialog,
  })),
)
const CommitDialog = lazy(() =>
  import('./CommitDialog').then((m) => ({
    default: m.CommitDialog,
  })),
)
const SessionSearchPanel = lazy(() =>
  import('./SessionSearchPanel').then((m) => ({
    default: m.SessionSearchPanel,
  })),
)

export function AppModals() {
  const { selectTerminal, mapPort } = useWorkspaceContext()
  const { clearSession } = useSessionContext()

  // Create terminal modal
  const [createModalOpen, setCreateModalOpen] = useState(false)
  useEffect(() => {
    const handler = () => setCreateModalOpen(true)
    window.addEventListener('open-create-terminal', handler)
    return () => window.removeEventListener('open-create-terminal', handler)
  }, [])

  // Branch commits dialog
  const [branchCommitsTarget, setBranchCommitsTarget] = useState<{
    terminalId: number
    branch: string
  } | null>(null)
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; branch: string }>,
    ) => {
      setBranchCommitsTarget(e.detail)
    }
    window.addEventListener('open-branch-commits', handler as EventListener)
    return () =>
      window.removeEventListener(
        'open-branch-commits',
        handler as EventListener,
      )
  }, [])

  // PR modal
  const [prModalTarget, setPrModalTarget] = useState<{
    prNumber: number
    repo: string
  } | null>(null)
  useEffect(() => {
    const handler = (e: CustomEvent<{ prNumber: number; repo: string }>) => {
      setPrModalTarget(e.detail)
    }
    window.addEventListener('open-pr-modal', handler as EventListener)
    return () =>
      window.removeEventListener('open-pr-modal', handler as EventListener)
  }, [])

  // Commit dialog
  const [commitDialogTarget, setCommitDialogTarget] = useState<{
    terminalId: number
    pr?: PRCheckStatus
  } | null>(null)
  const [commitSheetState, setCommitSheetState] = useState<
    'closed' | 'expanded' | 'collapsed'
  >('closed')
  const commitDialogTargetRef = useRef(commitDialogTarget)
  commitDialogTargetRef.current = commitDialogTarget
  const commitSheetStateRef = useRef(commitSheetState)
  commitSheetStateRef.current = commitSheetState
  useEffect(() => {
    const handler = (
      e: CustomEvent<{ terminalId: number; pr?: PRCheckStatus }>,
    ) => {
      const current = commitDialogTargetRef.current
      const currentState = commitSheetStateRef.current
      // If collapsed and same terminal — just expand
      if (
        currentState === 'collapsed' &&
        current &&
        current.terminalId === e.detail.terminalId &&
        !e.detail.pr === !current.pr
      ) {
        setCommitSheetState('expanded')
        return
      }
      // Otherwise set new target and expand
      setCommitDialogTarget(e.detail)
      setCommitSheetState('expanded')
    }
    window.addEventListener('open-commit-dialog', handler as EventListener)
    return () =>
      window.removeEventListener('open-commit-dialog', handler as EventListener)
  }, [])

  // Session search
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false)
  const [sessionSearchMounted, setSessionSearchMounted] = useState(false)
  useEffect(() => {
    const handler = () => {
      setSessionSearchMounted(true)
      setSessionSearchOpen(true)
    }
    window.addEventListener('open-session-search', handler)
    return () => window.removeEventListener('open-session-search', handler)
  }, [])

  // Port mapping modal
  const [portMappingTarget, setPortMappingTarget] = useState<{
    terminalId: number
    port: number
  } | null>(null)
  useEffect(() => {
    const handler = (e: CustomEvent<{ terminalId: number; port: number }>) => {
      setPortMappingTarget(e.detail)
    }
    window.addEventListener('open-port-mapping', handler as EventListener)
    return () =>
      window.removeEventListener('open-port-mapping', handler as EventListener)
  }, [])

  return (
    <>
      <CreateTerminalModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreated={(id) => {
          selectTerminal(id)
          clearSession()
        }}
      />
      {branchCommitsTarget && (
        <Suspense>
          <BranchCommitsDialog
            open
            terminalId={branchCommitsTarget.terminalId}
            branch={branchCommitsTarget.branch}
            onClose={() => setBranchCommitsTarget(null)}
          />
        </Suspense>
      )}
      {prModalTarget && (
        <PRModal
          prNumber={prModalTarget.prNumber}
          repo={prModalTarget.repo}
          onClose={() => setPrModalTarget(null)}
        />
      )}
      {portMappingTarget && (
        <PortMappingModal
          open={!!portMappingTarget}
          remotePort={portMappingTarget.port}
          onSave={async (localPort) => {
            try {
              await mapPort(
                portMappingTarget.terminalId,
                portMappingTarget.port,
                localPort,
              )
              toast.success(
                `Mapped remote port ${portMappingTarget.port} to localhost:${localPort}`,
              )
              setPortMappingTarget(null)
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : 'Failed to map port',
              )
            }
          }}
          onCancel={() => setPortMappingTarget(null)}
        />
      )}
      {commitDialogTarget && (
        <Suspense>
          <CommitDialog
            state={commitSheetState}
            terminalId={commitDialogTarget.terminalId}
            pr={commitDialogTarget.pr}
            onClose={() => {
              setCommitSheetState('closed')
              window.dispatchEvent(new Event('dialog-closed'))
              setTimeout(() => setCommitDialogTarget(null), 300)
            }}
            onCollapse={() => setCommitSheetState('collapsed')}
            onExpand={() => setCommitSheetState('expanded')}
          />
        </Suspense>
      )}
      {sessionSearchMounted && (
        <Suspense>
          <SessionSearchPanel
            open={sessionSearchOpen}
            onOpenChange={setSessionSearchOpen}
            onDismiss={() => {
              setSessionSearchOpen(false)
              window.dispatchEvent(new Event('dialog-closed'))
              setTimeout(() => setSessionSearchMounted(false), 300)
            }}
          />
        </Suspense>
      )}
    </>
  )
}
