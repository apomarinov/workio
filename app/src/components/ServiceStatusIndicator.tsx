import type {
  ClaudeSubStatus,
  ClaudeTunnelStatus,
  GitHubApiStatus,
  NgrokStatus,
  ServiceStatus,
  ServicesStatus,
} from '@server/types/status'
import {
  AlertTriangle,
  CircleHelp,
  Globe,
  HeartPulse,
  ScrollText,
  ServerOff,
  Settings,
} from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useUIState } from '@/context/UIStateContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useCertWarning } from '@/hooks/useCertWarning'
import { cn } from '@/lib/utils'
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
  certWarning: boolean,
): ServiceStatus {
  const all: ServiceStatus[] = [
    status.githubRest.status,
    status.githubGraphql.status,
    status.ngrok.status,
    ...Object.values(status.claudeTunnels).flatMap((t) => [
      t.bootstrap.status,
      t.tunnel.status,
    ]),
  ]
  if (webhookWarning.missingCount > 0) all.push('error')
  else if (webhookWarning.orphanedCount > 0) all.push('degraded')
  if (certWarning) all.push('degraded')
  return worstStatus(all)
}

const STATUS_COLOR: Record<ServiceStatus, string> = {
  healthy: 'text-muted-foreground',
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

const SERVICE_INFO: Record<string, string> = {
  'GitHub REST':
    'The GitHub REST API is used to fetch pull request details, comments, reviews, and manage webhooks. GitHub imposes a rate limit of 5,000 requests per hour per authenticated user.',
  'GitHub GraphQL':
    'The GitHub GraphQL API is used for efficient batch queries — fetching PR check statuses, review threads, and repository metadata in a single request. Rate-limited to 5,000 points per hour.',
  'GitHub Webhooks':
    "GitHub webhooks deliver real-time notifications when events happen on your repositories (PR updates, comments, check completions). Missing webhooks mean some repos won't get live updates; orphaned webhooks are stale entries that can be cleaned up.",
  ngrok:
    'ngrok creates a public tunnel to your local server, making the entire app accessible over the internet (protected by basic auth). This is also how GitHub delivers webhook events to your machine. Without it, webhooks cannot reach you and PR updates will rely on polling instead.',
  'Claude Tunnels':
    'Claude tunnels connect remote SSH hosts back to your local WorkIO server via SSH reverse tunnels. Bootstrap sets up the forwarder script and hooks on the remote host. The tunnel keeps the connection alive so Claude hooks on remote machines can forward events back to WorkIO.',
}

const SETTINGS_PATH: Record<string, string[]> = {
  'GitHub REST': ['GitHub', 'PR Data'],
  'GitHub GraphQL': ['GitHub', 'Query Limits'],
  'GitHub Webhooks': ['GitHub', 'Webhooks'],
  ngrok: ['Remote Access', 'ngrok'],
}

const SERVICE_LOG_KEY: Record<string, string> = {
  'GitHub REST': 'github-rest',
  'GitHub GraphQL': 'github-graphql',
  'GitHub Webhooks': 'github-webhooks',
}

function openServiceLogs(label: string) {
  const service = SERVICE_LOG_KEY[label]
  if (!service) return
  window.dispatchEvent(
    new CustomEvent('open-logs', {
      detail: { service, category: 'github' },
    }),
  )
}

function LogsButton({ label }: { label: string }) {
  if (!SERVICE_LOG_KEY[label]) return null
  return (
    <button
      type="button"
      className="text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
      onClick={() => openServiceLogs(label)}
      title="View logs"
    >
      <ScrollText className="w-3 h-3" />
    </button>
  )
}

function InfoButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  const uiState = useUIState()
  const info = SERVICE_INFO[label]
  const settingsPath = SETTINGS_PATH[label]
  if (!info) return null
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <CircleHelp className="w-3 h-3" />
      </button>
      {settingsPath && (
        <button
          type="button"
          className="text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          onClick={() => uiState.settings.open(settingsPath)}
        >
          <Settings className="w-3 h-3" />
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{label}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {info}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ErrorText({ error, label }: { error: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="text-[11px] text-red-400 max-w-[350px] text-left cursor-pointer hover:underline"
        onClick={() => setOpen(true)}
      >
        {error}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{label} Error</DialogTitle>
          </DialogHeader>
          <pre className="text-xs text-red-400 whitespace-pre-wrap break-all bg-zinc-900 rounded p-3 max-h-[60vh] overflow-auto">
            {error}
          </pre>
        </DialogContent>
      </Dialog>
    </>
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusDot status={api.status} />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <LogsButton label={label} />
          <InfoButton label={label} />
        </div>
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
        {api.error && <ErrorText error={api.error} label={label} />}
      </div>
    </div>
  )
}

function NgrokSection({ ngrok }: { ngrok: NgrokStatus }) {
  return (
    <div className="py-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusDot status={ngrok.status} />
          <span className="text-xs font-medium">ngrok</span>
        </div>
        <InfoButton label="ngrok" />
      </div>
      <div className="pl-3 mt-0.5 space-y-0">
        {ngrok.url && (
          <div className="text-[10px] text-muted-foreground">
            {ngrok.url.replace('https://', '')}
          </div>
        )}
        {ngrok.error && <ErrorText error={ngrok.error} label="ngrok" />}
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusDot status={webhookStatus} />
          <span className="text-xs font-medium">GitHub Webhooks</span>
        </div>
        <div className="flex items-center gap-1">
          <LogsButton label="GitHub Webhooks" />
          <InfoButton label="GitHub Webhooks" />
        </div>
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

function CertRow({ hasWarning }: { hasWarning: boolean }) {
  const uiState = useUIState()
  return (
    <div className="py-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusDot status={hasWarning ? 'degraded' : 'healthy'} />
          <span className="text-xs font-medium">HTTPS Certificate</span>
        </div>
        <button
          type="button"
          className="text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
          onClick={() =>
            uiState.settings.open([
              'General',
              'Notifications',
              'Mobile Notifications',
            ])
          }
        >
          <Settings className="w-3 h-3" />
        </button>
      </div>
      {hasWarning && (
        <div className="pl-3 mt-0.5">
          <div className="text-[10px] text-amber-500">IP mismatch</div>
        </div>
      )}
    </div>
  )
}

function SubStatusRow({ label, sub }: { label: string; sub: ClaudeSubStatus }) {
  if (sub.status === 'inactive') return null
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={sub.status} />
        <span className="text-[11px] text-muted-foreground truncate">
          {label}
        </span>
      </div>
      {sub.retries > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
          retries: {sub.retries}
        </span>
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
  const hostLabel = tunnel.alias || stableId
  const allHealthy =
    tunnel.bootstrap.status === 'healthy' && tunnel.tunnel.status === 'healthy'
  return (
    <div className="py-0.5">
      <span className="text-xs font-medium truncate flex items-center gap-1">
        <Globe
          className={cn(
            'w-3 h-3 flex-shrink-0',
            allHealthy && 'text-green-500',
          )}
        />
        {hostLabel}
      </span>
      {!allHealthy && (
        <div className="pl-3 mt-0.5 space-y-0.5">
          <SubStatusRow label="Bootstrap" sub={tunnel.bootstrap} />
          {tunnel.bootstrap.error && (
            <ErrorText
              error={tunnel.bootstrap.error}
              label={`${hostLabel} Bootstrap`}
            />
          )}
          <SubStatusRow label="Tunnel" sub={tunnel.tunnel} />
          {tunnel.tunnel.error && (
            <ErrorText
              error={tunnel.tunnel.error}
              label={`${hostLabel} Tunnel`}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function ServiceStatusIndicator({ className }: { className?: string }) {
  const { servicesStatus } = useWorkspaceContext()
  const { missingCount, orphanedCount } = useWebhookWarning()
  const { hasWarning: certWarning } = useCertWarning()

  if (!servicesStatus) return null

  const status = overallStatus(
    servicesStatus,
    { missingCount, orphanedCount },
    certWarning,
  )
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
          {certWarning && <CertRow hasWarning={certWarning} />}
        </div>

        {tunnelEntries.length > 0 && (
          <>
            <div className="border-t border-zinc-700/50 my-2" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <ClaudeIcon className="w-3 h-3" />
                Claude Tunnels
              </span>
              <InfoButton label="Claude Tunnels" />
            </div>
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
