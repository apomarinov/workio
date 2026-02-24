import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  Send,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/sonner'
import { useSettings } from '../hooks/useSettings'
import type { PushSubscriptionRecord } from '../types'

interface PushNotificationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

export function PushNotificationModal({
  open,
  onOpenChange,
}: PushNotificationModalProps) {
  const { settings, refetch } = useSettings()
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [testing, setTesting] = useState(false)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  const subscriptions = settings?.push_subscriptions ?? []
  const supported = 'serviceWorker' in navigator && 'PushManager' in window

  useEffect(() => {
    if (!open) return
    getCurrentSubscription().then((sub) => {
      setCurrentEndpoint(sub?.endpoint ?? null)
    })
  }, [open])

  const handleEnable = async () => {
    setEnabling(true)
    try {
      const res = await fetch('/api/push/vapid-key')
      const { publicKey } = await res.json()

      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      const subJson = subscription.toJSON()
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      })

      setCurrentEndpoint(subJson.endpoint ?? null)
      refetch()
      toast.success('Push notifications enabled')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to enable push notifications',
      )
    } finally {
      setEnabling(false)
    }
  }

  const handleDisable = async () => {
    setDisabling(true)
    try {
      const sub = await getCurrentSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setCurrentEndpoint(null)
      refetch()
      toast.success('Push notifications disabled')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to disable push notifications',
      )
    } finally {
      setDisabling(false)
    }
  }

  const handleRemoveDevice = async (endpoint: string) => {
    try {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
      refetch()
      if (endpoint === currentEndpoint) {
        setCurrentEndpoint(null)
      }
      toast.success('Device removed')
    } catch {
      toast.error('Failed to remove device')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      await fetch('/api/push/test', { method: 'POST' })
      toast.success('Test notification sent')
    } catch {
      toast.error('Failed to send test notification')
    } finally {
      setTesting(false)
    }
  }

  const [dismissing, setDismissing] = useState(false)
  const handleTestDismiss = async () => {
    setDismissing(true)
    try {
      await fetch('/api/push/test-dismiss', { method: 'POST' })
      toast.success('Dismiss sent')
    } catch {
      toast.error('Failed to send dismiss')
    } finally {
      setDismissing(false)
    }
  }

  const isSubscribed = !!currentEndpoint

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-sidebar max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Push Notifications</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!supported && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-400">
              Push notifications are not available. On iPhone/iPad, you must
              access via HTTPS and install the app as a PWA (Add to Home Screen)
              first.
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Receive push notifications even when the app is closed. Works with
            the PWA on iPhone, Android, and desktop browsers.
          </p>

          <div className="flex gap-2">
            {isSubscribed ? (
              <Button
                variant="outline"
                onClick={handleDisable}
                disabled={disabling}
              >
                <BellOff className="w-4 h-4 mr-2" />
                {disabling ? 'Disabling...' : 'Disable on this device'}
              </Button>
            ) : (
              <Button onClick={handleEnable} disabled={enabling || !supported}>
                <Bell className="w-4 h-4 mr-2" />
                {enabling ? 'Enabling...' : 'Enable on this device'}
              </Button>
            )}
            {subscriptions.length > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {testing ? 'Sending...' : 'Test'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleTestDismiss}
                  disabled={dismissing}
                >
                  <BellOff className="w-4 h-4 mr-2" />
                  {dismissing ? 'Dismissing...' : 'Dismiss'}
                </Button>
              </>
            )}
          </div>

          {subscriptions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Subscribed Devices</h4>
              <div className="space-y-1">
                {subscriptions.map((sub: PushSubscriptionRecord) => {
                  const isCurrent = sub.endpoint === currentEndpoint
                  const label = parseUserAgent(sub.userAgent)
                  return (
                    <div
                      key={sub.endpoint}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Smartphone className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">
                          {label}
                          {isCurrent && (
                            <span className="ml-1.5 text-xs text-green-500">
                              (this device)
                            </span>
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => handleRemoveDevice(sub.endpoint)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* iPhone HTTPS setup guide */}
          <div className="border-t pt-3">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium w-full text-left"
              onClick={() => setShowGuide(!showGuide)}
            >
              {showGuide ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              iPhone HTTPS Setup Guide
            </button>

            {showGuide && (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Push notifications on iPhone require HTTPS. Follow these steps
                  to set up self-signed HTTPS with mkcert.
                </p>

                <div>
                  <h4 className="font-medium">1. Install mkcert</h4>
                  <code className="block mt-1 px-3 py-2 rounded-md bg-muted text-xs">
                    brew install mkcert
                  </code>
                </div>

                <div>
                  <h4 className="font-medium">2. Generate certificates</h4>
                  <code className="block mt-1 px-3 py-2 rounded-md bg-muted text-xs">
                    cd app && npm run certs
                  </code>
                  <p className="text-xs text-muted-foreground mt-1">
                    Auto-detects your LAN IP and generates certs for localhost +
                    your IP.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium">3. Trust the CA on iPhone</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    The script prints the path to <code>rootCA.pem</code>.
                    AirDrop it to your iPhone, then:
                  </p>
                  <ul className="text-xs text-muted-foreground mt-1 ml-4 list-disc space-y-1">
                    <li>
                      <strong>
                        Settings &gt; General &gt; VPN & Device Management
                      </strong>{' '}
                      — install the profile
                    </li>
                    <li>
                      <strong>
                        Settings &gt; General &gt; About &gt; Certificate Trust
                        Settings
                      </strong>{' '}
                      — enable full trust for the mkcert root certificate
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium">4. Restart the dev server</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Both Vite and Fastify will detect the certs and serve over
                    HTTPS automatically.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium">5. Open on iPhone</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Navigate to <code>https://&lt;your-lan-ip&gt;:5175</code> in
                    Safari. Add to Home Screen to install as a PWA.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium">6. Enable push notifications</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the <strong>Enable on this device</strong> button above.
                    Safari will prompt for permission.
                  </p>
                </div>

                <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
                  <strong>If your local IP changes</strong> (e.g. different
                  Wi-Fi), run <code>npm run certs</code> again. The root CA
                  stays the same, so you don't need to re-trust anything on
                  iPhone — only the leaf certificate is regenerated.
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const array = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    array[i] = raw.charCodeAt(i)
  }
  return array.buffer as ArrayBuffer
}

function parseUserAgent(ua?: string): string {
  if (!ua) return 'Unknown device'
  if (ua.includes('iPhone')) return 'iPhone'
  if (ua.includes('iPad')) return 'iPad'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('Mac OS')) return 'Mac'
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Linux')) return 'Linux'
  return 'Browser'
}
