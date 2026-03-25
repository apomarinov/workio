import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { GitDiffStat, GitLastCommit } from '@domains/git/schema'
import type { ActiveProcess } from '@domains/pty/schema'
import type {
  StatusBarConfig,
  StatusBarSection,
  StatusBarSectionName,
} from '@domains/settings/schema'
import type { Terminal } from '@domains/workspace/schema/terminals'
import {
  Activity,
  Check,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  MoreVertical,
  Settings2,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useGitHubContext } from '@/context/GitHubContext'
import { useProcessContext } from '@/context/ProcessContext'
import { useWorkspaceContext } from '@/context/WorkspaceContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useOverflowDetector } from '@/hooks/useOverflowDetector'
import { useSettings } from '@/hooks/useSettings'
import { getPRStatusInfo } from '@/lib/pr-status'
import { formatTimeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'
import { GitStatus } from './GitStatus'
import { ResourceInfo } from './ResourceInfo'
import { PortsList, ProcessesList } from './terminal-status-sections'

const STATUS_BAR_SECTION_LABELS: Record<StatusBarSectionName, string> = {
  pr: 'Pull Request',
  resources: 'Resources',
  processes: 'Processes',
  ports: 'Ports',
  gitDirty: 'Git Changes',
  lastCommit: 'Last Commit',
  branch: 'Branch',
  spacer: 'Spacer',
}

interface StatusBarProps {
  position: 'top' | 'bottom'
}

function SortableStatusSection({
  section,
  children,
  onClick,
  className: extraClassName,
}: {
  section: StatusBarSection
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.name })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ('relative' as const) : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.()
      }}
      className={cn(
        'flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer flex-shrink-0',
        extraClassName,
      )}
    >
      {children}
    </div>
  )
}

function PRSection({
  section,
  pr,
}: {
  section: StatusBarSection
  pr: NonNullable<ReturnType<typeof useGitHubContext>['githubPRs'][number]>
}) {
  const overflowRef = useOverflowDetector<HTMLSpanElement>()
  const prInfo = getPRStatusInfo(pr)
  const isMobile = useIsMobile()

  const openModal = () =>
    window.dispatchEvent(
      new CustomEvent('open-pr-modal', {
        detail: { prNumber: pr.prNumber, repo: pr.repo },
      }),
    )

  return (
    <SortableStatusSection
      section={section}
      onClick={openModal}
      className="group/pr relative"
    >
      {prInfo.icon({ cls: 'w-3 h-3', group: 'group-hover/pr' })}
      {pr.hasUnreadNotifications && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
      )}
      <span ref={overflowRef} className="truncate-fade max-w-[250px]">
        {pr.prTitle}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          window.dispatchEvent(
            new CustomEvent('open-item-actions', {
              detail: {
                terminalId: null,
                sessionId: null,
                prNumber: pr.prNumber,
                prRepo: pr.repo,
              },
            }),
          )
        }}
        className={cn(
          'absolute right-0 inset-y-0 items-center px-1 bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer',
          !isMobile ? 'hidden group-hover/pr:flex' : '!bg-accent/50',
        )}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
    </SortableStatusSection>
  )
}

function ProcessesSection({
  section,
  processes,
  shells,
  terminalId,
  terminalName,
}: {
  section: StatusBarSection
  processes: ActiveProcess[]
  shells: Terminal['shells']
  terminalId: number
  terminalName: string | null
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div>
          <SortableStatusSection section={section}>
            <Activity className="w-3 h-3 text-green-400/80" />{' '}
            {processes.length}
          </SortableStatusSection>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start" side="bottom">
        <ProcessesList
          processes={processes}
          shells={shells}
          terminalId={terminalId}
          terminalName={terminalName}
          compact
        />
      </PopoverContent>
    </Popover>
  )
}

function ResourcesSection({
  section,
  terminalId,
}: {
  section: StatusBarSection
  terminalId: number
}) {
  return (
    <SortableStatusSection section={section} className="p-0">
      <ResourceInfo terminalId={terminalId} className="h-full py-2 px-2" />
    </SortableStatusSection>
  )
}

function PortsSection({
  section,
  terminalId,
  shellPorts,
  terminalPorts,
  shells,
  terminalName,
}: {
  section: StatusBarSection
  terminalId: number
  shellPorts: Record<number, number[]>
  terminalPorts: number[]
  shells: Terminal['shells']
  terminalName: string | null
}) {
  const totalPorts = terminalPorts.length
  const [isOpen, setIsOpen] = useState(false)
  const { portForwardStatus } = useProcessContext()
  const hasError = portForwardStatus[terminalId]?.some((s) => s.error)
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div>
          <SortableStatusSection section={section}>
            <Globe
              className={cn(
                'w-3 h-3 flex-shrink-0',
                hasError ? 'text-orange-400/80' : 'text-blue-400/80',
              )}
            />{' '}
            {totalPorts}
          </SortableStatusSection>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" side="bottom">
        <PortsList
          terminalId={terminalId}
          onClick={() => setIsOpen(false)}
          shellPorts={shellPorts}
          terminalPorts={terminalPorts}
          shells={shells}
          terminalName={terminalName}
          compact
        />
      </PopoverContent>
    </Popover>
  )
}

function GitDirtySection({
  section,
  diffStat,
  terminalId,
  remoteSyncStat,
}: {
  section: StatusBarSection
  diffStat: GitDiffStat | null
  terminalId: number
  remoteSyncStat?: { behind: number; ahead: number; noRemote: boolean }
}) {
  return (
    <SortableStatusSection
      section={section}
      onClick={() => {
        if (!diffStat) {
          window.dispatchEvent(
            new CustomEvent('open-branch-actions', { detail: { terminalId } }),
          )
          return
        }
        window.dispatchEvent(
          new CustomEvent('open-commit-dialog', {
            detail: { terminalId },
          }),
        )
      }}
    >
      <GitStatus
        terminalId={terminalId}
        diffStat={diffStat}
        remoteSyncStat={remoteSyncStat}
        badgeClassName="text-[11px]"
      />
    </SortableStatusSection>
  )
}

function BranchSection({
  section,
  branch,
  terminalId,
}: {
  section: StatusBarSection
  branch: string
  terminalId: number
}) {
  const overflowRef = useOverflowDetector<HTMLSpanElement>()
  return (
    <SortableStatusSection
      section={section}
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent('open-branch-actions', {
            detail: { terminalId },
          }),
        )
      }}
    >
      <GitBranch className="w-3 h-3" />
      <span ref={overflowRef} className="truncate-fade max-w-[220px]">
        {branch}
      </span>
    </SortableStatusSection>
  )
}

function LastCommitSection({
  section,
  commit,
  terminalId,
  branch,
}: {
  section: StatusBarSection
  commit: GitLastCommit
  terminalId: number
  branch: string
}) {
  const displayAuthor = commit.isLocal ? 'You' : commit.author
  return (
    <SortableStatusSection
      section={section}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent('open-branch-commits', {
            detail: { terminalId, branch },
          }),
        )
      }
    >
      <GitCommitHorizontal className="w-3 h-3" />
      <span className="truncate-fade max-w-[150px]">{displayAuthor}</span>
      <span className="text-muted-foreground/60">
        {formatTimeAgo(commit.date)}
      </span>
    </SortableStatusSection>
  )
}

function SpacerSection({ section }: { section: StatusBarSection }) {
  const isMobile = useIsMobile()
  if (isMobile) return null
  return (
    <SortableStatusSection section={section} className="flex-1 min-w-2 !p-0">
      {null}
    </SortableStatusSection>
  )
}

function StatusBarMenu({
  statusBar,
  updateSettings,
}: {
  statusBar: StatusBarConfig
  updateSettings: (updates: Record<string, unknown>) => Promise<unknown>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isMobile = useIsMobile()

  const toggleSection = (name: StatusBarSectionName) => {
    const newSections = statusBar.sections.map((s) =>
      s.name === name ? { ...s, visible: !s.visible } : s,
    )
    updateSettings({ statusBar: { ...statusBar, sections: newSections } })
  }

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground/60 hover:text-foreground"
        >
          <Settings2 className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="end" side="bottom">
        <div className="p-1">
          <label className="flex hover:bg-accent w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer">
            Status Bar
            <Switch
              checked={statusBar.enabled}
              onCheckedChange={(v) =>
                updateSettings({ statusBar: { ...statusBar, enabled: v } })
              }
            />
          </label>
          <label
            className={cn(
              'flex w-full items-center hover:bg-accent justify-between rounded-sm px-2 py-1.5 text-sm',
              statusBar.enabled
                ? 'cursor-pointer'
                : 'opacity-50 cursor-not-allowed',
            )}
          >
            On Top
            <Switch
              checked={statusBar.onTop}
              onCheckedChange={(v) =>
                updateSettings({ statusBar: { ...statusBar, onTop: v } })
              }
              disabled={!statusBar.enabled || isMobile}
            />
          </label>
        </div>
        <div className="h-px bg-border" />
        <div className="p-1">
          {statusBar.sections
            .filter((s) => s.name !== 'spacer')
            .sort((a, b) => a.order - b.order)
            .map((section) => (
              <button
                key={section.name}
                type="button"
                onClick={() => toggleSection(section.name)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
              >
                {STATUS_BAR_SECTION_LABELS[section.name]}
                {section.visible && (
                  <Check className="w-3.5 h-3.5 text-foreground" />
                )}
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function StatusBar({ position }: StatusBarProps) {
  const { activeTerminal: terminal } = useWorkspaceContext()
  const { githubPRs } = useGitHubContext()
  const {
    processes: allProcesses,
    terminalPorts,
    shellPorts,
    resourceInfo,
    gitDirtyStatus,
    gitLastCommit,
    gitRemoteSyncStatus,
  } = useProcessContext()
  const { settings, updateSettings } = useSettings()
  const isMobile = useIsMobile()

  // statusBar always has a default from the server, with missing sections backfilled
  const statusBar = settings!.statusBar

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  if (!terminal) return null

  // All processes/ports for this terminal
  const processes = allProcesses.filter((p) => p.terminalId === terminal.id)
  const ports = terminalPorts[terminal.id] ?? []
  const diffStat = gitDirtyStatus[terminal.id]
  const isDirty =
    !!diffStat &&
    (diffStat.added > 0 || diffStat.removed > 0 || diffStat.untracked > 0)
  const remoteSyncStat = gitRemoteSyncStatus[terminal.id]
  const hasDivergence =
    !!remoteSyncStat &&
    (remoteSyncStat.noRemote ||
      remoteSyncStat.behind > 0 ||
      remoteSyncStat.ahead > 0)
  const lastCommit = gitLastCommit[terminal.id]

  const prForBranch = terminal.git_branch
    ? (githubPRs.find(
        (pr) => pr.branch === terminal.git_branch && pr.state === 'OPEN',
      ) ??
      githubPRs.find(
        (pr) => pr.branch === terminal.git_branch && pr.state === 'MERGED',
      ))
    : undefined

  // Get sorted visible sections
  const sortedSections = [...statusBar.sections].sort(
    (a, b) => a.order - b.order,
  )

  // Check which sections have content
  const hasContent = (name: StatusBarSectionName): boolean => {
    switch (name) {
      case 'pr':
        return !!prForBranch
      case 'resources':
        return (
          resourceInfo.totalRam > 0 &&
          resourceInfo.totalCpu > 0 &&
          Object.keys(resourceInfo.usage).length > 0
        )
      case 'processes':
        return processes.length > 0
      case 'ports':
        return ports.length > 0
      case 'gitDirty':
        return isDirty || hasDivergence
      case 'lastCommit':
        return !!lastCommit
      case 'branch':
        return !!terminal.git_branch
      case 'spacer':
        return true
    }
  }

  // Filter to visible sections that have content
  const visibleSections = sortedSections.filter(
    (s) => (s.name === 'spacer' || s.visible) && hasContent(s.name),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const names = sortedSections.map((s) => s.name)
    const oldIndex = names.indexOf(active.id as StatusBarSectionName)
    const newIndex = names.indexOf(over.id as StatusBarSectionName)
    if (oldIndex === -1 || newIndex === -1) return

    const newNames = [...names]
    newNames.splice(oldIndex, 1)
    newNames.splice(newIndex, 0, active.id as StatusBarSectionName)

    const newSections = statusBar.sections.map((s) => ({
      ...s,
      order: newNames.indexOf(s.name),
    }))
    updateSettings({ statusBar: { ...statusBar, sections: newSections } })
  }

  const renderSection = (section: StatusBarSection) => {
    switch (section.name) {
      case 'pr':
        return prForBranch ? (
          <PRSection key={section.name} section={section} pr={prForBranch} />
        ) : null
      case 'resources':
        return (
          <ResourcesSection
            key={section.name}
            section={section}
            terminalId={terminal.id}
          />
        )
      case 'processes':
        return processes.length > 0 ? (
          <ProcessesSection
            key={section.name}
            section={section}
            processes={processes}
            shells={terminal.shells}
            terminalId={terminal.id}
            terminalName={terminal.name}
          />
        ) : null
      case 'ports':
        return ports.length > 0 ? (
          <PortsSection
            key={section.name}
            section={section}
            terminalId={terminal.id}
            shellPorts={shellPorts}
            terminalPorts={ports}
            shells={terminal.shells}
            terminalName={terminal.name}
          />
        ) : null
      case 'gitDirty':
        return isDirty || hasDivergence ? (
          <GitDirtySection
            key={section.name}
            section={section}
            diffStat={isDirty ? diffStat : null}
            terminalId={terminal.id}
            remoteSyncStat={remoteSyncStat}
          />
        ) : null
      case 'lastCommit':
        return lastCommit && terminal.git_branch ? (
          <LastCommitSection
            key={section.name}
            section={section}
            commit={lastCommit}
            terminalId={terminal.id}
            branch={terminal.git_branch}
          />
        ) : null
      case 'branch':
        return terminal.git_branch ? (
          <BranchSection
            key={section.name}
            section={section}
            branch={terminal.git_branch}
            terminalId={terminal.id}
          />
        ) : null
      case 'spacer':
        return <SpacerSection key={section.name} section={section} />
    }
  }

  return (
    <div className={cn('w-full bg-[#1a1a1a] flex relative items-center')}>
      <div
        className={cn(
          'absolute left-0 w-full h-[0.02rem] bg-zinc-400/30 z-1',
          position === 'top' && 'bottom-[0.02rem]',
          position === 'bottom' && !isMobile && 'top-[0.02rem]',
          position === 'bottom' && isMobile && 'bottom-[0.02rem]',
        )}
      ></div>
      <div className="flex items-center w-full overflow-x-auto relative">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleSections.map((s) => s.name)}
            strategy={horizontalListSortingStrategy}
          >
            {visibleSections.map(renderSection)}
          </SortableContext>
        </DndContext>
      </div>
      <div className="px-1 relative mr-1">
        {isMobile && (
          <div
            className={cn(
              'absolute left-0 top-[-2px] w-[0.02rem] h-[calc(100%+3px)] bg-zinc-400/30 z-1',
            )}
          ></div>
        )}
        <StatusBarMenu statusBar={statusBar} updateSettings={updateSettings} />
      </div>
    </div>
  )
}
