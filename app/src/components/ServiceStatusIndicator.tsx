import { AlertTriangle, HeartPulse, ServerOff } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTerminalContext } from '@/context/TerminalContext'
import { cn } from '@/lib/utils'
import type {
  ClaudeTunnelStatus,
  GitHubApiStatus,
  NgrokStatus,
  ServiceStatus,
  ServicesStatus,
} from '../../shared/types'
import { useWebhookWarning } from './GitHubModal'
import { ClaudeIcon } from './icons'

function worstStatus(statuses: ServiceStatus[]): ServiceStatus {
  if (statuses.some((s) => s === 'error')) return 'error'
  if (statuses.some((s) => s === 'degraded')) return 'degraded'
  if (statuses.some((s) => s === 'starting')) return 'starting'
  if (statuses.every((s) => s === 'inactive')) return 'inactive'
  if (statuses.some((s) => s === 'healthy')) return 'healthy'
  return 'inactive'
}

function overallStatus(
  status: ServicesStatus,
  webhookWarning: { missingCount: number; orphanedCount: number },
): ServiceStatus {
  const all: ServiceStatus[] = [
    status.githubRest.status,
    status.githubGraphql.status,
    status.ngrok.status,
    ...Object.values(status.claudeTunnels).map((t) => t.status),
  ]
  // Factor webhook health into overall status
  if (webhookWarning.missingCount > 0) all.push('error')
  else if (webhookWarning.orphanedCount > 0) all.push('degraded')
  return worstStatus(all)
}

const STATUS_COLOR: Record<ServiceStatus, string> = {
  healthy: 'text-green-500',
  degraded: 'text-amber-500',
  error: 'text-red-500',
  starting: 'text-blue-400',
  inactive: 'text-muted-foreground/50',
}

const STATUS_DOT: Record<ServiceStatus, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-amber-500',
  error: 'bg-red-500',
  starting: 'bg-blue-400',
  inactive: 'bg-zinc-600',
}

function StatusDot({ status }: { status: ServiceStatus }) {
  return (
    <span
      className={cn(
        'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
        STATUS_DOT[status],
        status === 'starting' && 'animate-pulse',
      )}
    />
  )
}

function GitHubApiSection({
  label,
  api,
}: {
  label: string
  api: GitHubApiStatus
}) {
  const resetMin =
    api.reset !== null
      ? Math.max(0, Math.ceil((api.reset * 1000 - Date.now()) / 60000))
      : null

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5">
        <StatusDot status={api.status} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="pl-3 mt-0.5 space-y-0">
        {api.remaining !== null && api.limit !== null && (
          <div className="text-[10px] text-muted-foreground">
            Remaining: {api.remaining} / {api.limit}
          </div>
        )}
        {resetMin !== null && (
          <div className="text-[10px] text-muted-foreground">
            Resets in: {resetMin}m
          </div>
        )}
        {api.error && (
          <div className="text-[10px] text-red-400">{api.error}</div>
        )}
      </div>
    </div>
  )
}

function NgrokSection({ ngrok }: { ngrok: NgrokStatus }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5">
        <StatusDot status={ngrok.status} />
        <span className="text-xs font-medium">ngrok</span>
      </div>
      <div className="pl-3 mt-0.5 space-y-0">
        {ngrok.url && (
          <div className="text-[10px] text-muted-foreground">
            {ngrok.url.replace('https://', '')}
          </div>
        )}
        {ngrok.error && (
          <div className="text-[10px] text-red-400">{ngrok.error}</div>
        )}
      </div>
    </div>
  )
}

function WebhooksRow({
  missingCount,
  orphanedCount,
}: {
  missingCount: number
  orphanedCount: number
}) {
  const hasIssues = missingCount > 0 || orphanedCount > 0
  const webhookStatus: ServiceStatus =
    missingCount > 0 ? 'error' : orphanedCount > 0 ? 'degraded' : 'healthy'

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5">
        <StatusDot status={webhookStatus} />
        <span className="text-xs font-medium">GitHub Webhooks</span>
      </div>
      {hasIssues && (
        <div className="pl-3 mt-0.5 space-y-0">
          {missingCount > 0 && (
            <div className="text-[10px] text-amber-500">
              {missingCount} missing
            </div>
          )}
          {orphanedCount > 0 && (
            <div className="text-[10px] text-orange-500">
              {orphanedCount} orphaned
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TunnelRow({
  stableId,
  tunnel,
}: {
  stableId: string
  tunnel: ClaudeTunnelStatus
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={tunnel.status} />
        <span className="text-xs truncate">{tunnel.alias || stableId}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {tunnel.tunnelRetries > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            retries: {tunnel.tunnelRetries}
          </span>
        )}
        {tunnel.error && (
          <span className="text-[10px] text-red-400 truncate max-w-[120px]">
            {tunnel.error}
          </span>
        )}
      </div>
    </div>
  )
}

export function ServiceStatusIndicator({ className }: { className?: string }) {
  const { servicesStatus } = useTerminalContext()
  const { missingCount, orphanedCount } = useWebhookWarning()

  if (!servicesStatus) return null

  const status = overallStatus(servicesStatus, { missingCount, orphanedCount })
  const tunnelEntries = Object.entries(servicesStatus.claudeTunnels)
  const hasWebhookConfig =
    missingCount > 0 ||
    orphanedCount > 0 ||
    servicesStatus.ngrok.status !== 'inactive'

  const StatusIcon =
    status === 'error'
      ? AlertTriangle
      : status === 'inactive'
        ? ServerOff
        : HeartPulse

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'cursor-pointer opacity-80',
            STATUS_COLOR[status],
            className,
          )}
          title="Service status"
        >
          <StatusIcon className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-fit max-w-[95vw] min-w-[220px] px-3 py-1"
        align="center"
      >
        <span className="text-xs font-medium text-muted-foreground">
          Serivce Status
        </span>
        <div className="mt-1 space-y-0">
          <GitHubApiSection
            label="GitHub REST"
            api={servicesStatus.githubRest}
          />
          <GitHubApiSection
            label="GitHub GraphQL"
            api={servicesStatus.githubGraphql}
          />
          {hasWebhookConfig && (
            <WebhooksRow
              missingCount={missingCount}
              orphanedCount={orphanedCount}
            />
          )}
          <NgrokSection ngrok={servicesStatus.ngrok} />
        </div>

        {tunnelEntries.length > 0 && (
          <>
            <div className="border-t border-zinc-700/50 my-2" />
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ClaudeIcon className="w-3 h-3" />
              Claude Tunnels
            </span>
            <div className="mt-1.5 space-y-0.5">
              {tunnelEntries.map(([id, tunnel]) => (
                <TunnelRow key={id} stableId={id} tunnel={tunnel} />
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
