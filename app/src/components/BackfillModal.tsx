import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import {
  type BackfillCheckResult,
  backfillCheck,
  backfillSessions,
} from '@/lib/api'
import { toastError } from '@/lib/toastError'
import { cn } from '@/lib/utils'
import { useSessionContext } from '../context/SessionContext'
import { useWorkspaceContext } from '../context/WorkspaceContext'

/**
 * Hook to check for unbackfilled sessions.
 * Uses SWR keyed on terminal IDs so it re-checks when terminals change.
 */
export function useBackfillCheck() {
  const { terminals } = useWorkspaceContext()
  const terminalKey = terminals.map((t) => t.id).join(',')

  const { data: results } = useSWR(
    terminalKey ? `backfill-check:${terminalKey}` : null,
    () => backfillCheck().then((d) => d.results),
    { dedupingInterval: 30_000 },
  )

  const totalCount =
    results?.reduce((sum, r) => sum + r.unbackfilledCount, 0) ?? 0

  return { hasBackfill: totalCount > 0, totalCount }
}

/**
 * Backfill section for the settings modal.
 * Shows a row with warning styling when there are unbackfilled sessions.
 * Opens a dialog to configure and run the backfill.
 */
export function BackfillSection() {
  const { terminals } = useWorkspaceContext()
  const { refetch: refetchSessions } = useSessionContext()
  const terminalKey = terminals.map((t) => t.id).join(',')

  const [open, setOpen] = useState(false)
  const [weeksBack, setWeeksBack] = useState(4)

  const {
    data: results,
    isLoading,
    mutate,
  } = useSWR(
    terminalKey ? `backfill-check:${terminalKey}:${weeksBack}` : null,
    () => backfillCheck(weeksBack).then((d) => d.results),
    { dedupingInterval: 30_000 },
  )
  const [backfillingCwd, setBackfillingCwd] = useState<string | null>(null)

  const totalCount =
    results?.reduce((sum, r) => sum + r.unbackfilledCount, 0) ?? 0
  const hasBackfill = totalCount > 0

  const handleBackfill = async (result: BackfillCheckResult) => {
    setBackfillingCwd(result.cwd)
    try {
      const data = await backfillSessions({
        encodedPath: result.encodedPath,
        cwd: result.cwd,
        terminalId: result.terminalId,
        shellId: result.shellId,
        weeksBack,
      })
      toast.success(
        `Backfilled ${data.backfilled} session${data.backfilled === 1 ? '' : 's'}`,
      )
      await mutate()
      refetchSessions()
    } catch (err) {
      toastError(err, 'Failed to backfill sessions')
    } finally {
      setBackfillingCwd(null)
    }
  }

  if (!hasBackfill) return null

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download className={cn('w-4 h-4', 'text-amber-500')} />
          <span className="text-sm font-medium">Import Sessions</span>
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <AlertTriangle className="w-3 h-3" />
            {totalCount} untracked
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Import
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(v) => !backfillingCwd && setOpen(v)}>
        <DialogContent
          onEscapeKeyDown={(e) => backfillingCwd && e.preventDefault()}
          onInteractOutside={(e) => backfillingCwd && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Import Sessions</DialogTitle>
            <DialogDescription>
              Import Claude Code sessions from JSONL files that aren't tracked
              in WorkIO.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground whitespace-nowrap">
              Sessions from the last
            </span>
            <Input
              type="number"
              min={1}
              max={52}
              value={weeksBack}
              onChange={(e) => setWeeksBack(Number(e.target.value) || 1)}
              disabled={backfillingCwd !== null}
              className="w-16 h-7"
            />
            <span className="text-muted-foreground">weeks</span>
          </div>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && results && results.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No unbackfilled sessions found
              </p>
            )}
            {!isLoading &&
              results?.map((r) => (
                <div
                  key={r.cwd}
                  className="flex items-center justify-between gap-2 p-2 rounded bg-sidebar-accent/30"
                >
                  <div className="min-w-0 flex-1">
                    {terminals.find((t) => t.id === r.terminalId)?.name && (
                      <p className="text-sm font-medium truncate">
                        {terminals.find((t) => t.id === r.terminalId)!.name}
                      </p>
                    )}
                    <p
                      className="text-xs text-muted-foreground truncate"
                      title={r.cwd}
                    >
                      {r.cwd}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.unbackfilledCount} session
                      {r.unbackfilledCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={backfillingCwd !== null}
                    onClick={() => handleBackfill(r)}
                  >
                    {backfillingCwd === r.cwd ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Import'
                    )}
                  </Button>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
