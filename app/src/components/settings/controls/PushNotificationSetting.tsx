import { pushSubscribeInput } from '@domains/notifications/schema'
import type { PushSubscriptionRecord } from '@domains/settings/schema'
import {
  AlertTriangle,
  Bell,
  BellOff,
  ChevronDown,
  Send,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SettingControlProps } from '@/components/settings/settings-registry'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { useNotifications } from '@/context/NotificationContext'
import { useCertWarning } from '@/hooks/useCertWarning'
import { useSettings } from '@/hooks/useSettings'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
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

export function PushNotificationSetting({ onWarning }: SettingControlProps) {
  const { settings, refetch } = useSettings()
  const { requestPermission } = useNotifications()
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [testing, setTesting] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [generating, setGenerating] = useState(false)

  const { data: vapidData } = trpc.notifications.vapidKey.useQuery()
  const { hasWarning: certWarning, certData } = useCertWarning()
  const generateCertsMutation = trpc.settings.generateCerts.useMutation()
  const certUtils = trpc.useUtils()

  useEffect(() => {
    onWarning?.(certWarning)
  }, [certWarning, onWarning])
  const subscribeMutation = trpc.notifications.pushSubscribe.useMutation()
  const unsubscribeMutation = trpc.notifications.pushUnsubscribe.useMutation()
  const testMutation = trpc.notifications.pushTest.useMutation()
  const testDismissMutation = trpc.notifications.pushTestDismiss.useMutation()

  const subscriptions = settings?.push_subscriptions ?? []
  const supported = 'serviceWorker' in navigator && 'PushManager' in window
  const isSubscribed = !!currentEndpoint

  useEffect(() => {
    getCurrentSubscription().then((sub) => {
      setCurrentEndpoint(sub?.endpoint ?? null)
    })
  }, [])

  const handleEnable = async () => {
    setEnabling(true)
    try {
      const granted = await requestPermission()
      if (!granted) {
        toast.error('Notification permission is required for push')
        return
      }
      if (!vapidData?.publicKey) {
        toast.error('VAPID key not available')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        await unsubscribeMutation.mutateAsync({ endpoint: existing.endpoint })
        await existing.unsubscribe()
      }
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      })
      const subJson = subscription.toJSON()
      const parsed = pushSubscribeInput.safeParse({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        userAgent: navigator.userAgent,
      })
      if (!parsed.success) {
        toast.error('Invalid push subscription data')
        return
      }
      await subscribeMutation.mutateAsync(parsed.data)
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
        await unsubscribeMutation.mutateAsync({ endpoint: sub.endpoint })
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
      await unsubscribeMutation.mutateAsync({ endpoint })
      refetch()
      if (endpoint === currentEndpoint) setCurrentEndpoint(null)
      toast.success('Device removed')
    } catch {
      toast.error('Failed to remove device')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      await testMutation.mutateAsync()
      toast.success('Test notification sent')
    } catch {
      toast.error('Failed to send test notification')
    } finally {
      setTesting(false)
    }
  }

  const handleTestDismiss = async () => {
    setDismissing(true)
    try {
      await testDismissMutation.mutateAsync()
      toast.success('Dismiss sent')
    } catch {
      toast.error('Failed to send dismiss')
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="space-y-4 w-full">
      {!supported && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-400">
          Push notifications are not available. On iPhone/iPad, you must access
          via HTTPS and install the app as a PWA (Add to Home Screen) first.
        </div>
      )}

      {certData && !certData.hasCert && (
        <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            No HTTPS certificate found. Mobile devices require HTTPS for push
            notifications and PWA icons.
          </span>
        </div>
      )}

      {certData?.hasCert && !certData.match && (
        <div className="flex items-center gap-2 text-amber-500 text-sm bg-amber-500/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            Certificate IP mismatch — cert has {certData.certIps.join(', ')} but
            your current IP is {certData.localIp}. Regenerate certs in the guide
            below and reinstall the PWA on your phone.
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Receive push notifications even when the app is closed. Works with the
        PWA on iPhone, Android. Intended for mobile PWA, desktop doesn't require
        this.
      </p>

      <div className="flex gap-2 flex-wrap">
        {isSubscribed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisable}
            disabled={disabling}
          >
            <BellOff className="w-3.5 h-3.5 mr-1.5" />
            {disabling ? 'Disabling...' : 'Disable on this device'}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleEnable}
            disabled={enabling || !supported}
          >
            <Bell className="w-3.5 h-3.5 mr-1.5" />
            {enabling ? 'Enabling...' : 'Enable on this device'}
          </Button>
        )}
        {subscriptions.length > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {testing ? 'Sending...' : 'Test'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestDismiss}
              disabled={dismissing}
            >
              <BellOff className="w-3.5 h-3.5 mr-1.5" />
              {dismissing ? 'Dismissing...' : 'Dismiss'}
            </Button>
          </>
        )}
      </div>

      {subscriptions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Subscribed Devices
          </h4>
          <div className="space-y-1">
            {subscriptions.map((sub: PushSubscriptionRecord) => {
              const isCurrent = sub.endpoint === currentEndpoint
              const label = parseUserAgent(sub.userAgent)
              return (
                <div
                  key={sub.endpoint}
                  className="flex items-center justify-between rounded-lg bg-[#1a1a1a] px-3 py-1.5 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate text-xs">
                      {label}
                      {isCurrent && (
                        <span className="ml-1.5 text-[10px] text-green-500">
                          (this device)
                        </span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveDevice(sub.endpoint)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* iPhone HTTPS setup guide */}
      <div className="border-t border-zinc-700/50 pt-3">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium w-full text-left text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={() => setShowGuide(!showGuide)}
        >
          <ChevronDown
            className={cn(
              'w-3 h-3 transition-transform',
              !showGuide && '-rotate-90',
            )}
          />
          HTTPS Setup Guide & iPhone Setup
        </button>

        {showGuide && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Push notifications on iPhone require HTTPS. Follow these steps to
              set up self-signed HTTPS with mkcert.
            </p>
            <div>
              <h4 className="font-medium text-xs">1. Install mkcert</h4>
              <code className="block mt-1 px-3 py-2 rounded-lg bg-[#1a1a1a] text-xs">
                brew install mkcert
              </code>
            </div>
            <div>
              <h4 className="font-medium text-xs">2. Generate certificates</h4>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                disabled={generating}
                onClick={async () => {
                  setGenerating(true)
                  try {
                    await generateCertsMutation.mutateAsync()
                    await certUtils.settings.validateCertIp.invalidate()
                    toast.success(
                      'Certificates generated — restart the dev server',
                    )
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : 'Failed to generate certificates',
                    )
                  } finally {
                    setGenerating(false)
                  }
                }}
              >
                {generating
                  ? 'Generating...'
                  : certData?.hasCert
                    ? 'Regenerate Certificates'
                    : 'Generate Certificates'}
              </Button>
            </div>
            <div>
              <h4 className="font-medium text-xs">
                3. Install root CA on iPhone
              </h4>
              <ul className="text-[11px] text-muted-foreground mt-1 ml-4 list-disc space-y-1">
                <li>
                  AirDrop or email the root CA file to your phone:{' '}
                  <code className="text-[10px]">
                    ~/Library/Application Support/mkcert/rootCA.pem
                  </code>
                </li>
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
                  — enable full trust for mkcert
                </li>
              </ul>
              <p className="text-[10px] text-muted-foreground/70 mt-1 ml-4">
                This is a one-time step. The root CA trusts all future certs, so
                you won't need to reinstall when regenerating.
              </p>
            </div>
            <div>
              <h4 className="font-medium text-xs">4. Restart the dev server</h4>
              <p className="text-[11px] text-muted-foreground mt-1">
                Both Vite and Fastify will detect the certs and serve over HTTPS
                automatically.
              </p>
            </div>
            <div>
              <h4 className="font-medium text-xs">
                5. Open on iPhone & enable
              </h4>
              <p className="text-[11px] text-muted-foreground mt-1">
                Navigate to{' '}
                <code>https://{certData?.localIp || '<your-lan-ip>'}:5175</code>{' '}
                in Safari. Add to Home Screen, then enable push above.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
