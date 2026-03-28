import {
  type SettingsUpdate,
  updateSettingsInput,
} from '@domains/settings/schema'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useUIState } from '@/context/UIStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettings } from '@/hooks/useSettings'
import { toastError } from '@/lib/toastError'
import {
  type FlatSetting,
  SETTINGS_REGISTRY,
  type SettingsSection,
  searchSettings,
} from './settings-registry'

interface SettingsViewContextValue {
  // Navigation
  search: string
  setSearch: (value: string) => void
  filtered: FlatSetting[]
  matchedCategories: Set<string>
  activePath: string[] | null
  setActivePath: (path: string[] | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  keymapOpen: boolean
  openKeymap: () => void
  closeKeymap: () => void
  isMobile: boolean
  categories: SettingsSection[]
  scrollToSection: (path: string[]) => void

  // Form
  formValues: Partial<SettingsUpdate>
  validationErrors: Record<string, string>
  setSettingsValue: <K extends keyof SettingsUpdate>(
    key: K,
    value: SettingsUpdate[K],
  ) => void
  saveSettings: () => Promise<void>
  saving: boolean
  dirty: boolean
}

const SettingsViewContext = createContext<SettingsViewContextValue | null>(null)

/** Walk the tree depth-first and return the path to the first section that has settings */
function getFirstSettingsPath(sections: SettingsSection[]): string[] | null {
  for (const section of sections) {
    if (section.settings && section.settings.length > 0) {
      return [section.name]
    }
    if (section.children) {
      const child = getFirstSettingsPath(section.children)
      if (child) return [section.name, ...child]
    }
  }
  return null
}

export function SettingsViewProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [keymapOpen, setKeymapOpen] = useState(false)
  const [activePath, setActivePath] = useState<string[] | null>(() =>
    getFirstSettingsPath(SETTINGS_REGISTRY),
  )
  const [formValues, setFormValues] = useState<Partial<SettingsUpdate>>({})
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({})
  const [saving, setSaving] = useState(false)

  const isMobile = useIsMobile()
  const { settingsTarget, clearSettingsTarget } = useUIState()
  const { settings, updateSettings } = useSettings()

  // Snapshot of settings when the form was initialized, for dirty comparison
  const baselineRef = useRef<string>('')

  // Initialize form from current settings on mount / when settings load
  useEffect(() => {
    if (!settings) return
    const snapshot = JSON.stringify(settings)
    // Only reset form if we haven't touched it yet or settings changed externally
    if (
      baselineRef.current !== snapshot &&
      Object.keys(formValues).length === 0
    ) {
      setFormValues({ ...settings })
      baselineRef.current = snapshot
    }
  }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to target setting when settings opens with a specific path
  useEffect(() => {
    if (!settingsTarget) return
    clearSettingsTarget()

    if (settingsTarget[0] === 'Keymap') {
      setKeymapOpen(true)
      setActivePath(settingsTarget)
      return
    }

    setKeymapOpen(false)
    setActivePath(settingsTarget)
    requestAnimationFrame(() => {
      const id = `settings-section-${settingsTarget.join('-')}`
      const el = document.getElementById(id)
      if (el) {
        const container = el.closest('[data-settings-scroll]')
        if (container) {
          const top = el.offsetTop - 45
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
      }
    })
  }, [settingsTarget, clearSettingsTarget])

  const filtered = searchSettings(search)
  const matchedCategories = new Set(filtered.map((s) => s.ancestors[0]))

  const scrollToSection = (path: string[]) => {
    const id = `settings-section-${path.join('-')}`
    const el = document.getElementById(id)
    if (el) {
      const container = el.closest('[data-settings-scroll]')
      if (container) {
        const top = el.offsetTop - 45
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      } else {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    }
    setActivePath(path)
    if (isMobile) setSidebarOpen(false)
  }

  const setSettingsValue = <K extends keyof SettingsUpdate>(
    key: K,
    value: SettingsUpdate[K],
  ) => {
    setFormValues((prev) => ({ ...prev, [key]: value }))

    // Validate the single field against the schema
    const result = updateSettingsInput.safeParse({ [key]: value })
    if (!result.success) {
      const fieldError = result.error.issues.find((i) =>
        i.path.includes(key as string),
      )
      if (fieldError) {
        setValidationErrors((prev) => ({
          ...prev,
          [key]: fieldError.message,
        }))
      }
    } else {
      setValidationErrors((prev) => {
        const { [key as string]: _, ...rest } = prev
        return rest
      })
    }
  }

  const dirty = baselineRef.current !== JSON.stringify(formValues)

  const saveSettings = async () => {
    if (!dirty) return

    // Diff against baseline to only send changed fields
    const baseline = baselineRef.current
      ? (JSON.parse(baselineRef.current) as Record<string, unknown>)
      : {}
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(formValues)) {
      if (JSON.stringify(value) !== JSON.stringify(baseline[key])) {
        updates[key] = value
      }
    }

    if (Object.keys(updates).length === 0) return

    // Validate changed fields before saving
    const result = updateSettingsInput.safeParse(updates)
    if (!result.success) {
      const errors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const key = issue.path.join('.')
        errors[key] = issue.message
      }
      setValidationErrors(errors)
      return
    }

    setSaving(true)
    try {
      await updateSettings(result.data as SettingsUpdate)
      baselineRef.current = JSON.stringify(formValues)
      setValidationErrors({})
    } catch (err) {
      toastError(err, 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsViewContext.Provider
      value={{
        search,
        setSearch,
        filtered,
        matchedCategories,
        activePath,
        setActivePath,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen((v) => !v),
        keymapOpen,
        openKeymap: () => setKeymapOpen(true),
        closeKeymap: () => setKeymapOpen(false),
        isMobile,
        categories: SETTINGS_REGISTRY,
        scrollToSection,
        formValues,
        validationErrors,
        setSettingsValue,
        saveSettings,
        saving,
        dirty,
      }}
    >
      {children}
    </SettingsViewContext.Provider>
  )
}

export function useSettingsView() {
  const ctx = useContext(SettingsViewContext)
  if (!ctx)
    throw new Error('useSettingsView must be used within SettingsViewProvider')
  return ctx
}
