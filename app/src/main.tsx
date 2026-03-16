import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'
import { NotificationProvider } from './context/NotificationContext'
import './index.css'
import App from './App'
import { trpc, trpcClient } from './lib/trpc'

const queryClient = new QueryClient()

const ONE_HOUR = 60 * 60 * 1000

function swrCacheProvider() {
  const map = new Map()
  const timestamps = new Map<string, number>()

  const interval = setInterval(
    () => {
      const now = Date.now()
      for (const [key, ts] of timestamps) {
        if (now - ts > ONE_HOUR) {
          map.delete(key)
          timestamps.delete(key)
        }
      }
    },
    5 * 60 * 1000,
  )

  // Clean up on page unload
  window.addEventListener('beforeunload', () => clearInterval(interval))

  const originalSet = map.set.bind(map)
  map.set = (key: string, value: unknown) => {
    timestamps.set(key, Date.now())
    return originalSet(key, value)
  }

  const originalDelete = map.delete.bind(map)
  map.delete = (key: string) => {
    timestamps.delete(key)
    return originalDelete(key)
  }

  return map
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SWRConfig
          value={{ provider: swrCacheProvider, revalidateOnFocus: false }}
        >
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </SWRConfig>
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
)
