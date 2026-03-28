import { WEBHOOK_EVENTS } from '@domains/github/schema'
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Link,
  Loader2,
  Plus,
  TestTube,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWebhookWarning } from '@/components/GitHubModal'
import { RefreshIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useNotifications } from '@/context/NotificationContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useSettings } from '@/hooks/useSettings'
import { useSocket } from '@/hooks/useSocket'
import * as api from '@/lib/api'
import { toastError } from '@/lib/toastError'

type WebhookStatus = 'active' | 'missing' | 'none' | 'orphaned'

interface RepoWebhookInfo {
  repo: string
  status: WebhookStatus
  webhookId?: number
}

export function WebhooksSetting({
  onWarning,
}: {
  onWarning?: (warning: boolean) => void
}) {
  const { settings, refetch, updateSettings } = useSettings()
  const { terminals } = useWorkspaceContext()
  const { subscribe } = useSocket()
  const { sendNotification } = useNotifications()
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [linkWebhookRepo, setLinkWebhookRepo] = useState<string | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return subscribe<{ repo: string }>('webhook:ping', ({ repo }) => {
      sendNotification('Webhook test received', {
        body: `Ping from ${repo}`,
        audio: 'pr-activity',
      })
    })
  }, [subscribe, sendNotification])

  const ngrokUrl = settings?.ngrok?.domain
    ? `https://${settings.ngrok.domain}`
    : null
  const repoWebhooks = settings?.repo_webhooks || {}

  const repos = useMemo(() => {
    const repoSet = new Set<string>()
    for (const terminal of terminals) {
      if (terminal.git_repo?.repo) repoSet.add(terminal.git_repo.repo)
    }
    return Array.from(repoSet).sort()
  }, [terminals])

  const repoWebhookInfos: RepoWebhookInfo[] = useMemo(() => {
    const repoSet = new Set(repos)
    const infos: RepoWebhookInfo[] = []
    for (const repo of repos) {
      const webhook = repoWebhooks[repo]
      let status: WebhookStatus = 'none'
      if (webhook) status = webhook.missing ? 'missing' : 'active'
      infos.push({ repo, status, webhookId: webhook?.id })
    }
    for (const [repo, webhook] of Object.entries(repoWebhooks)) {
      if (!repoSet.has(repo)) {
        infos.push({ repo, status: 'orphaned', webhookId: webhook.id })
      }
    }
    return infos
  }, [repos, repoWebhooks])

  const { missingCount, orphanedCount, noNgrok } = useWebhookWarning()

  useEffect(() => {
    onWarning?.(noNgrok || missingCount > 0 || orphanedCount > 0)
  }, [noNgrok, missingCount, orphanedCount, onWarning])

  const handleCreate = async (repo: string) => {
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) return
    setLoading((prev) => ({ ...prev, [repo]: true }))
    try {
      await api.createWebhook(owner, repoName)
      toast.success(`Webhook created for ${repo}`)
      refetch()
    } catch (err) {
      toastError(err, 'Failed to create webhook')
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
      toastError(err, 'Failed to delete webhook')
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
      toastError(err, 'Failed to recreate webhook')
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
      toast.success(`Ping sent to ${repo}`)
    } catch (err) {
      toastError(err, 'Failed to test webhook')
    } finally {
      setLoading((prev) => ({ ...prev, [`${repo}-test`]: false }))
    }
  }

  const handleLinkWebhook = async (repo: string, webhookId: number) => {
    setLoading((prev) => ({ ...prev, [repo]: true }))
    try {
      const currentWebhooks = settings?.repo_webhooks || {}
      await updateSettings({
        repo_webhooks: { ...currentWebhooks, [repo]: { id: webhookId } },
      })
      toast.success(`Webhook ${webhookId} linked for ${repo}`)
      setLinkWebhookRepo(null)
      refetch()
    } catch (err) {
      toastError(err, 'Failed to link webhook')
    } finally {
      setLoading((prev) => ({ ...prev, [repo]: false }))
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
    <div className="space-y-3 w-full">
      {/* Tunnel URL */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Tunnel URL</div>
        {noNgrok ? (
          <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-3 py-1.5 rounded-lg">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              ngrok not running. Configure domain and token in Remote Access.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg">
            <code className="text-sm flex-1 truncate">{ngrokUrl}</code>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={copyNgrokUrl}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {missingCount > 0 && (
        <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {missingCount} webhook{missingCount > 1 ? 's' : ''} missing.
          </span>
        </div>
      )}
      {orphanedCount > 0 && (
        <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {orphanedCount} webhook{orphanedCount > 1 ? 's' : ''} for repos
            without projects.
          </span>
        </div>
      )}

      {/* Repo list */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Repositories</div>
        {repos.length === 0 && Object.keys(repoWebhooks).length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No GitHub repositories found in projects.
          </div>
        ) : (
          <div className="space-y-2">
            {repoWebhookInfos.map(({ repo, status }) => (
              <div key={repo} className="space-y-1">
                <div className="flex items-center gap-2 bg-[#1a1a1a] px-3 py-1.5 rounded-lg">
                  <div className="flex-shrink-0">
                    <div
                      className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-green-500' : status === 'missing' ? 'bg-amber-500' : status === 'orphaned' ? 'bg-orange-500' : 'bg-gray-500'}`}
                    />
                  </div>
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm flex-1 truncate hover:underline flex items-center gap-1"
                  >
                    {repo}
                    <ExternalLink className="w-3 h-3 opacity-50" />
                  </a>
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
                                onClick={() => {
                                  setLinkWebhookRepo(repo)
                                  requestAnimationFrame(() =>
                                    linkInputRef.current?.focus(),
                                  )
                                }}
                              >
                                <Link className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Link existing webhook by ID
                            </TooltipContent>
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
                {linkWebhookRepo === repo && (
                  <form
                    className="flex items-center gap-2 px-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const value = linkInputRef.current?.value?.trim()
                      const id = value ? Number.parseInt(value, 10) : Number.NaN
                      if (!Number.isFinite(id) || id <= 0) {
                        toast.error('Enter a valid webhook ID')
                        return
                      }
                      handleLinkWebhook(repo, id)
                    }}
                  >
                    <Input
                      ref={linkInputRef}
                      type="number"
                      placeholder="Webhook ID"
                      className="h-7 text-xs flex-1"
                      min={1}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="h-7 text-xs px-2"
                      disabled={loading[repo]}
                    >
                      {loading[repo] ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Save'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => setLinkWebhookRepo(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                )}
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
  )
}
