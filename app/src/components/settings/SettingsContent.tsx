import { ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getSettingControl } from './controls-map'
import { useSettingsView } from './SettingsViewContext'
import { SETTINGS_REGISTRY, type SettingsSection } from './settings-registry'

export function SettingsContent() {
  const { filtered, search, setActivePath, keymapOpen } = useSettingsView()
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const sectionEls = container.querySelectorAll<HTMLElement>(
      '[data-section-path]',
    )
    let best: string | null = null
    const offset = container.scrollTop + 60
    for (const el of sectionEls) {
      if (el.offsetTop <= offset) {
        best = el.dataset.sectionPath ?? null
      }
    }
    if (best) setActivePath(best.split('/'))
  }

  // When searching, show flat filtered results
  if (search.trim()) {
    return (
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            No settings match "{search}"
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl">
            {filtered.map((s) => (
              <SettingRow key={s.key} setting={s} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Default: render all sections recursively
  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex-1 overflow-y-auto',
        keymapOpen && 'invisible pointer-events-none',
      )}
      data-settings-scroll
      onScroll={handleScroll}
    >
      {SETTINGS_REGISTRY.map((section) => (
        <SectionRenderer
          key={section.name}
          section={section}
          path={[section.name]}
          depth={0}
        />
      ))}
    </div>
  )
}

function SectionRenderer({
  section,
  path,
  depth,
}: {
  section: SettingsSection
  path: string[]
  depth: number
}) {
  const { activePath } = useSettingsView()
  const id = `settings-section-${path.join('-')}`
  const sectionPath = path.join('/')

  // Build the active sub-path breadcrumb for sticky headers
  const activeSubPath =
    activePath && activePath[0] === path[0] ? activePath.slice(1) : null

  // Top-level sections get a sticky header
  if (depth === 0) {
    return (
      <div id={id} data-section-path={sectionPath}>
        <div
          className={cn(
            'sticky top-0 z-10 bg-[#1a1a1a] px-4 sm:px-6 py-2 border-b border-zinc-700/40',
            activeSubPath && activeSubPath.length > 0 && 'bg-[#222]',
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
            <span className="flex items-center gap-2 whitespace-nowrap">
              {section.icon && (
                <section.icon className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span className="font-semibold">{section.name}</span>
            </span>
            {activeSubPath &&
              activeSubPath.length > 0 &&
              activeSubPath.map((part) => (
                <span
                  key={part}
                  className="flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span className="text-muted-foreground/40">&rsaquo;</span>
                  <span className="text-muted-foreground text-xs">{part}</span>
                </span>
              ))}
          </div>
        </div>
        <div className="max-w-2xl px-4 sm:px-6 mt-3 mb-6">
          {section.settings && (
            <div className="space-y-3 mb-6">
              {section.settings.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  sectionPath={path}
                />
              ))}
            </div>
          )}
          {section.children?.map((child) => (
            <SectionRenderer
              key={child.name}
              section={child}
              path={[...path, child.name]}
              depth={depth + 1}
            />
          ))}
        </div>
      </div>
    )
  }

  // Nested sections get a subheading
  return (
    <div id={id} data-section-path={sectionPath} className="mb-6">
      <h3 className="text-xs font-medium text-muted-foreground mb-1">
        {section.name}
      </h3>
      {section.description && (
        <p className="text-[11px] text-muted-foreground/60 mb-3">
          {section.description}
        </p>
      )}
      {section.settings && (
        <div className="space-y-3 mb-4">
          {section.settings.map((setting) => (
            <SettingRow
              key={setting.key}
              setting={setting}
              sectionPath={path}
            />
          ))}
        </div>
      )}
      {section.children?.map((child) => (
        <SectionRenderer
          key={child.name}
          section={child}
          path={[...path, child.name]}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

function SettingRow({
  setting,
  sectionPath,
}: {
  setting: {
    key: string
    label: string
    description: string
    path?: string
    column?: boolean
    collapsed?: boolean
  }
  sectionPath?: string[]
}) {
  const Control = getSettingControl(setting.key)
  const { addSectionWarning, removeSectionWarning, flashKey } =
    useSettingsView()
  const isFlashing = flashKey === setting.key
  const [expanded, setExpanded] = useState(!setting.collapsed)
  const [warning, setWarning] = useState(false)

  const handleWarning = (hasWarning: boolean) => {
    setWarning(hasWarning)
    if (!sectionPath) return
    // Register warnings for all ancestor paths
    for (let i = 1; i <= sectionPath.length; i++) {
      const key = sectionPath.slice(0, i).join('/')
      if (hasWarning) addSectionWarning(key)
      else removeSectionWarning(key)
    }
  }

  return (
    <div
      className={cn(
        'rounded-md border group/settings-row bg-muted transition-colors duration-700',
        warning
          ? 'border-amber-500/50'
          : isFlashing
            ? 'border-blue-500'
            : 'border-zinc-700/50',
        !setting.collapsed && 'px-4 py-3',
      )}
    >
      {setting.path && (
        <div className="text-[10px] text-muted-foreground/60 mb-1">
          {setting.path}
        </div>
      )}
      <div
        onClick={() => {
          if (setting.collapsed) {
            setExpanded((v) => !v)
          }
        }}
        className={cn(
          setting.column
            ? 'space-y-3'
            : 'flex items-center justify-between gap-4',
          setting.collapsed && 'cursor-pointer px-4 py-3',
        )}
      >
        <div className="w-full flex justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {setting.label}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {setting.description}
            </div>
          </div>
          {setting.collapsed != null && (
            <button
              type="button"
              className="flex-shrink-0 p-1 text-muted-foreground group-hover/settings-row:text-foreground"
            >
              <ChevronDown
                className={cn(
                  'w-4 h-4 transition-transform',
                  !expanded && '-rotate-90',
                )}
              />
            </button>
          )}
        </div>
        {setting.collapsed == null && <Control onWarning={handleWarning} />}
      </div>
      {setting.collapsed != null && (
        <div className={cn(expanded ? '' : 'hidden', 'px-4 py-3')}>
          <Control onWarning={handleWarning} />
        </div>
      )}
    </div>
  )
}
