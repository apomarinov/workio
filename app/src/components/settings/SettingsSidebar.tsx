import { cn } from '@/lib/utils'
import { useSettingsView } from './SettingsViewContext'
import type { SettingsSection } from './settings-registry'

function pathMatches(activePath: string[] | null, path: string[]) {
  if (!activePath) return false
  return (
    path.length <= activePath.length &&
    path.every((p, i) => activePath[i] === p)
  )
}

export function SettingsSidebar() {
  const {
    categories,
    matchedCategories,
    activePath,
    scrollToSection,
    sectionWarnings,
  } = useSettingsView()

  return (
    <div className="w-full h-full sm:w-48 flex-shrink-0 border-r border-zinc-700/50 bg-[#1a1a1a] overflow-y-auto max-sm:pt-[env(safe-area-inset-top)]">
      <nav>
        {categories.map((section) => {
          const dimmed =
            matchedCategories.size > 0 && !matchedCategories.has(section.name)
          const path = [section.name]
          const active = pathMatches(activePath, path)
          return (
            <div key={section.name} className={cn(dimmed && 'opacity-40')}>
              <button
                type="button"
                onClick={() => scrollToSection(path)}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-3 sm:py-1.5 text-sm sm:text-xs cursor-pointer transition-colors',
                  active
                    ? 'text-foreground bg-zinc-700/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-zinc-700/20',
                )}
              >
                {section.icon && (
                  <section.icon
                    className={cn(
                      'w-4 h-4',
                      sectionWarnings.has(path.join('/')) && 'text-amber-500',
                    )}
                  />
                )}
                <span
                  className={cn(
                    'font-medium',
                    sectionWarnings.has(path.join('/')) && 'text-amber-500',
                  )}
                >
                  {section.name}
                </span>
              </button>
              {section.children && (
                <SidebarChildren
                  sections={section.children}
                  parentPath={path}
                  depth={1}
                />
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

function SidebarChildren({
  sections,
  parentPath,
  depth,
}: {
  sections: SettingsSection[]
  parentPath: string[]
  depth: number
}) {
  const { activePath, scrollToSection, sectionWarnings } = useSettingsView()

  return (
    <div>
      {sections.map((section) => {
        const path = [...parentPath, section.name]
        const active = pathMatches(activePath, path)
        return (
          <div key={section.name}>
            <button
              type="button"
              onClick={() => scrollToSection(path)}
              style={{ paddingLeft: `${depth * 8 + 28}px` }}
              className={cn(
                'flex items-center gap-2 w-full text-left pr-2 py-2.5 sm:py-1 text-sm sm:text-xs cursor-pointer transition-colors',
                active
                  ? 'text-foreground bg-zinc-700/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-700/20',
              )}
            >
              {section.icon && (
                <section.icon
                  className={cn(
                    'w-3.5 h-3.5',
                    sectionWarnings.has(path.join('/')) && 'text-amber-500',
                  )}
                />
              )}
              <span
                className={cn(
                  sectionWarnings.has(path.join('/')) && 'text-amber-500',
                )}
              >
                {section.name}
              </span>
            </button>
            {section.children && (
              <SidebarChildren
                sections={section.children}
                parentPath={path}
                depth={depth + 1}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
