import { Menu, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSettingsView } from './SettingsViewContext'

export function SettingsHeader() {
  const { search, setSearch, isMobile, toggleSidebar } = useSettingsView()

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50">
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={toggleSidebar}
        >
          <Menu className="w-4 h-4" />
        </Button>
      )}
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search settings..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            'w-full h-8 pl-8 pr-8 rounded-md bg-zinc-800/50 border border-zinc-700/50 text-base text-foreground placeholder:text-muted-foreground',
            'outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/50 transition-colors',
          )}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
