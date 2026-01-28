import { useCallback, useEffect, useState } from 'react'

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch {
      return initialValue
    }
  })

  // Sync across tabs and same-window components
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setStoredValue(JSON.parse(e.newValue))
        } catch {
          // ignore parse errors
        }
      }
    }

    // Custom event for same-window sync (storage event doesn't fire in same window)
    const handleLocalSync = (e: CustomEvent<{ key: string; value: T }>) => {
      if (e.detail.key === key) {
        setStoredValue(e.detail.value)
      }
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(
      'local-storage-sync',
      handleLocalSync as EventListener,
    )

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(
        'local-storage-sync',
        handleLocalSync as EventListener,
      )
    }
  }, [key])

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const valueToStore = value instanceof Function ? value(prev) : value
        window.localStorage.setItem(key, JSON.stringify(valueToStore))
        // Dispatch custom event for same-window sync (deferred to avoid setState during render)
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('local-storage-sync', {
              detail: { key, value: valueToStore },
            }),
          )
        })
        return valueToStore
      })
    },
    [key],
  )

  return [storedValue, setValue]
}
