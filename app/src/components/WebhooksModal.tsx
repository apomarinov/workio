import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  TestTube,
  Trash2,
  Webhook,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useNotifications } from '@/context/NotificationContext'
import { useTerminalContext } from '@/context/TerminalContext'
import { useSettings } from '@/hooks/useSettings'
import { useSocket } from '@/hooks/useSocket'
import * as api from '@/lib/api'
import { WEBHOOK_EVENTS } from '../../shared/types'
import { RefreshIcon } from './icons'

interface WebhooksModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type WebhookStatus = 'active' | 'missing' | 'none' | 'orphaned'

interface RepoWebhookInfo {
  repo: string
  status: WebhookStatus
  webhookId?: number
}

export function WebhooksModal({ open, onOpenChange }: WebhooksModalProps) {
  const { settings, refetch } = useSettings()
  const { terminals } = useTerminalContext()
  const { subscribe } = useSocket()
  const { sendNotification } = useNotifications()
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  // Listen for webhook ping events
  useEffect(() => {
    return subscribe<{ repo: string }>('webhook:ping', ({ repo }) => {
      sendNotification('🔔 Webhook test received', {
        body: `Ping from ${repo}`,
        audio: 'pr-activity',
      })
    })
  }, [subscribe, sendNotification])

  const ngrokUrl = settings?.ngrok_url
  const repoWebhooks = settings?.repo_webhooks || {}

  // Get unique repos from terminals
  const repos = useMemo(() => {
    const repoSet = new Set<string>()
    for (const terminal of terminals) {
      if (terminal.git_repo?.repo) {
        repoSet.add(terminal.git_repo.repo)
      }
    }
    return Array.from(repoSet).sort()
  }, [terminals])

  // Build webhook info for each repo (from terminals + orphaned webhooks)
  const repoWebhookInfos: RepoWebhookInfo[] = useMemo(() => {
    const repoSet = new Set(repos)
    const infos: RepoWebhookInfo[] = []

    // Add repos from terminals
    for (const repo of repos) {
      const webhook = repoWebhooks[repo]
      let status: WebhookStatus = 'none'
      if (webhook) {
        status = webhook.missing ? 'missing' : 'active'
      }
      infos.push({ repo, status, webhookId: webhook?.id })
    }

    // Add orphaned webhooks (webhooks for repos not in any terminal)
    for (const [repo, webhook] of Object.entries(repoWebhooks)) {
      if (!repoSet.has(repo)) {
        infos.push({
          repo,
          status: 'orphaned',
          webhookId: webhook.id,
        })
      }
    }

    return infos
  }, [repos, repoWebhooks])

  const missingCount = settings?.missingWebhookCount ?? 0
  const orphanedCount = settings?.orphanedWebhookCount ?? 0
  const noNgrok = !ngrokUrl

  const handleCreate = async (repo: string) => {
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) return

    setLoading((prev) => ({ ...prev, [repo]: true }))
    try {
      await api.createWebhook(owner, repoName)
      toast.success(`Webhook created for ${repo}`)
      refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create webhook',
      )
    } finally {
      setLoading((prev) => ({ ...prev, [repo]: false }))
    }
  }

  const handleDelete = async (repo: string) => {
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) return

    setLoading((prev) => ({ ...prev, [repo]: true }))
    try {
      await api.deleteWebhook(owner, repoName)
      toast.success(`Webhook deleted for ${repo}`)
      refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete webhook',
      )
    } finally {
      setLoading((prev) => ({ ...prev, [repo]: false }))
    }
  }

  const handleRecreate = async (repo: string) => {
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) return

    setLoading((prev) => ({ ...prev, [repo]: true }))
    try {
      await api.recreateWebhook(owner, repoName)
      toast.success(`Webhook recreated for ${repo}`)
      refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to recreate webhook',
      )
    } finally {
      setLoading((prev) => ({ ...prev, [repo]: false }))
    }
  }

  const handleTest = async (repo: string) => {
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) return

    setLoading((prev) => ({ ...prev, [`${repo}-test`]: true }))
    try {
      await api.testWebhook(owner, repoName)
      toast.success(`Ping sent to ${repo} webhook`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to test webhook')
    } finally {
      setLoading((prev) => ({ ...prev, [`${repo}-test`]: false }))
    }
  }

  const copyNgrokUrl = () => {
    if (ngrokUrl) {
      navigator.clipboard.writeText(ngrokUrl)
      toast.success('Copied to clipboard')
    }
  }

  const copyWebhookCommand = (repo: string) => {
    const secret = settings?.webhook_secret
    if (!ngrokUrl || !secret) {
      toast.error('Missing ngrok URL or webhook secret')
      return
    }

    const webhookUrl = `${ngrokUrl}/api/webhooks/github`
    const eventsArgs = WEBHOOK_EVENTS.map((e) => `-f 'events[]=${e}'`).join(' ')
    const command = `gh api repos/${repo}/hooks -X POST -f name=web -f 'config[url]=${webhookUrl}' -f 'config[content_type]=json' -f 'config[secret]=${secret}' ${eventsArgs}`

    navigator.clipboard.writeText(command)
    toast.success('Command copied to clipboard')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-sidebar max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="w-5 h-5" />
            GitHub Webhooks
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ngrok URL section */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Tunnel URL</div>
            {noNgrok ? (
              <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 p-2 rounded">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  ngrok not running. Set NGROK_AUTHTOKEN environment variable
                  and restart the server.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-muted/50 p-2 rounded">
                <code className="text-sm flex-1 truncate">{ngrokUrl}</code>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={copyNgrokUrl}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy URL</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>

          {/* Warning for missing webhooks */}
          {missingCount > 0 && (
            <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 p-2 rounded">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                {missingCount} webhook{missingCount > 1 ? 's' : ''} missing.
                They may have been deleted from GitHub.
              </span>
            </div>
          )}

          {/* Warning for orphaned webhooks */}
          {orphanedCount > 0 && (
            <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 p-2 rounded">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                {orphanedCount} webhook{orphanedCount > 1 ? 's' : ''} for repos
                without projects. Consider deleting them.
              </span>
            </div>
          )}

          {/* Repo list */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Repositories</div>
            {repos.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No GitHub repositories found in projects.
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {repoWebhookInfos.map(({ repo, status }) => (
                  <div
                    key={repo}
                    className="flex items-center gap-2 bg-muted/30 p-2 rounded"
                  >
                    {/* Status indicator */}
                    <div className="flex-shrink-0">
                      {status === 'active' && (
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                      )}
                      {status === 'missing' && (
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                      )}
                      {status === 'orphaned' && (
                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                      )}
                      {status === 'none' && (
                        <div className="w-2 h-2 rounded-full bg-gray-500" />
                      )}
                    </div>

                    {/* Repo name */}
                    <a
                      href={`https://github.com/${repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm flex-1 truncate hover:underline flex items-center gap-1"
                    >
                      {repo}
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </a>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <TooltipProvider>
                        {status === 'none' && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={noNgrok}
                                  onClick={() => copyWebhookCommand(repo)}
                                >
                                  <Copy className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy gh command</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={loading[repo] || noNgrok}
                                  onClick={() => handleCreate(repo)}
                                >
                                  {loading[repo] ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Plus className="w-4 h-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Create webhook</TooltipContent>
                            </Tooltip>
                          </>
                        )}

                        {status === 'missing' && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={loading[repo] || noNgrok}
                                onClick={() => handleRecreate(repo)}
                              >
                                {loading[repo] ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshIcon className="w-4 h-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Recreate webhook</TooltipContent>
                          </Tooltip>
                        )}

                        {(status === 'active' || status === 'orphaned') && (
                          <>
                            {status === 'active' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    disabled={loading[`${repo}-test`]}
                                    onClick={() => handleTest(repo)}
                                  >
                                    {loading[`${repo}-test`] ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <TestTube className="w-4 h-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Test webhook</TooltipContent>
                              </Tooltip>
                            )}

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={loading[repo]}
                                  onClick={() => handleDelete(repo)}
                                >
                                  {loading[repo] ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete webhook</TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </TooltipProvider>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t flex-wrap">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span>Active</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Missing</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span>Orphaned</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-gray-500" />
              <span>Not configured</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function useWebhookWarning(): {
  hasWarning: boolean
  missingCount: number
  orphanedCount: number
  noNgrok: boolean
} {
  const { settings } = useSettings()

  const missingCount = settings?.missingWebhookCount ?? 0
  const orphanedCount = settings?.orphanedWebhookCount ?? 0
  const noNgrok = !settings?.ngrok_url
  const hasWarning = missingCount > 0 || orphanedCount > 0 || noNgrok

  return { hasWarning, missingCount, orphanedCount, noNgrok }
}
