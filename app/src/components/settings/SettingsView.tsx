import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { KeymapView } from './KeymapView'
import { SettingsContent } from './SettingsContent'
import { SettingsHeader } from './SettingsHeader'
import { SettingsSidebar } from './SettingsSidebar'
import { SettingsViewProvider, useSettingsView } from './SettingsViewContext'

function SettingsViewInner() {
  const {
    isMobile,
    sidebarOpen,
    setSidebarOpen,
    keymapOpen,
    dirty,
    saving,
    saveSettings,
  } = useSettingsView()

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a]">
      <SettingsHeader />
      <div className="flex flex-1 min-h-0 relative">
        {!isMobile && <SettingsSidebar />}

        {isMobile && (
          <>
            <div
              className={cn(
                'fixed inset-0 z-40 bg-black/50 transition-opacity',
                sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
              )}
              onClick={() => setSidebarOpen(false)}
            />
            <div
              className={cn(
                'fixed inset-y-0 left-0 z-50 w-full transition-transform duration-200',
                sidebarOpen ? 'translate-x-0' : '-translate-x-full',
              )}
            >
              <SettingsSidebar />
            </div>
          </>
        )}

        <SettingsContent />
        {keymapOpen && <KeymapView />}

        {dirty && (
          <div className="absolute bottom-4 right-4 z-20">
            <Button
              onClick={saveSettings}
              disabled={saving}
              className="gap-2 shadow-lg"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsView() {
  return (
    <SettingsViewProvider>
      <SettingsViewInner />
    </SettingsViewProvider>
  )
}
