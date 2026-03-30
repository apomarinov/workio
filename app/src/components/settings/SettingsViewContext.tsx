import {
  type SettingsUpdate,
  updateSettingsFormInput,
} from '@domains/settings/schema'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useUIState } from '@/context/UIStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSettings } from '@/hooks/useSettings'
import { getByPath, setByPath } from '@/lib/object'
import { toastError } from '@/lib/toastError'
import {
  type FlatSetting,
  flattenSettings,
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
  flashKey: string | null

  // Warnings
  sectionWarnings: Set<string>
  addSectionWarning: (path: string) => void
  removeSectionWarning: (path: string) => void

  // Form
  formValues: Partial<SettingsUpdate>
  validationErrors: Record<string, string>
  getFormValue: (path: string) => unknown
  setFormValue: (path: string, value: unknown) => void
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [keymapOpen, setKeymapOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activePath, setActivePath] = useState<string[] | null>(() =>
    getFirstSettingsPath(SETTINGS_REGISTRY),
  )
  const [sectionWarnings, setSectionWarnings] = useState<Set<string>>(new Set())
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Partial<SettingsUpdate>>({})
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({})
  const [saving, setSaving] = useState(false)

  const isMobile = useIsMobile()
  const uiState = useUIState()
  const settingsTarget = uiState.settings.target
  const clearSettingsTarget = uiState.settings.clearTarget
  const { settings, updateSettings } = useSettings()

  // Snapshot of settings when the form was initialized, for dirty comparison
  const baselineRef = useRef<string>('')

  // Sync form from current settings on mount and when settings change externally
  useEffect(() => {
    if (!settings) return
    const snapshot = JSON.stringify(settings)
    if (baselineRef.current === snapshot) return
    // Only reset form if it hasn't been touched (not dirty)
    const currentFormSnapshot = JSON.stringify(formValues)
    if (
      Object.keys(formValues).length === 0 ||
      baselineRef.current === currentFormSnapshot
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

    // Find first setting key in the target section for flashing
    const flat = flattenSettings()
    const targetPath = settingsTarget.join(' > ')
    const firstSetting = flat.find((s) => s.path.startsWith(targetPath))
    if (firstSetting) {
      setFlashKey(firstSetting.key)
      setTimeout(() => setFlashKey(null), 2000)
    }

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

  const getFormValue = (path: string): unknown => {
    return getByPath(formValues, path)
  }

  const setFormValue = (path: string, value: unknown) => {
    setFormValues((prev) => setByPath(prev, path, value))

    // Validate the top-level field
    const rootKey = path.split('.')[0]
    const fieldSchema =
      updateSettingsFormInput.shape[
        rootKey as keyof typeof updateSettingsFormInput.shape
      ]
    if (!fieldSchema) return
    const updated = setByPath({ ...formValues }, path, value)
    const rootValue = (updated as Record<string, unknown>)[rootKey]
    const result = fieldSchema.safeParse(rootValue)
    if (!result.success) {
      const fieldError = result.error.issues[0]
      if (fieldError) {
        setValidationErrors((prev) => ({
          ...prev,
          [path]: fieldError.message,
        }))
      }
    } else {
      setValidationErrors((prev) => {
        const { [path]: _, ...rest } = prev
        return rest
      })
    }
  }

  const addSectionWarning = (path: string) => {
    setSectionWarnings((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }

  const removeSectionWarning = (path: string) => {
    setSectionWarnings((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
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

    setSaving(true)
    try {
      await updateSettings(updates as SettingsUpdate)
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
        flashKey,
        sectionWarnings,
        addSectionWarning,
        removeSectionWarning,
        formValues,
        validationErrors,
        getFormValue,
        setFormValue,
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
