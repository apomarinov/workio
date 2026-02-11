import {
  AlertTriangle,
  Bot,
  Check,
  CornerDownLeft,
  GitBranch,
  GitMerge,
  Globe,
  Heart,
  ScrollText,
  Search,
  TerminalSquare,
} from 'lucide-react'
import { getPRStatusInfo } from '@/lib/pr-status'
import { cn } from '@/lib/utils'
import type { PRCheckStatus } from '../../../../shared/types'
import { PRTabButton } from '../../PRStatusContent'
import type { AppActions, AppData } from '../createPaletteModes'
import { getLastPathSegment } from '../createPaletteModes'
import type {
  PaletteAPI,
  PaletteItem,
  PaletteLevel,
  PaletteMode,
} from '../types'

const sessionStatusColor: Record<string, string> = {
  started: 'text-green-500',
  active: 'text-[#D97757]',
  done: 'text-gray-500',
  ended: 'text-gray-500',
  permission_needed: 'text-[#D97757]',
  idle: 'text-gray-400',
}

function SessionIcon({ status }: { status: string }) {
  if (status === 'done')
    return <Check className="h-4 w-4 shrink-0 text-green-500/70" />
  if (status === 'active' || status === 'permission_needed')
    return (
      <>
        {(status === 'active' || status === 'permission_needed') && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 300 150"
            className="h-4 w-4 shrink-0"
          >
            <path
              fill="none"
              stroke="#D97757"
              strokeWidth="40"
              strokeLinecap="round"
              strokeDasharray="300 385"
              strokeDashoffset="0"
              d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"
            >
              <animate
                attributeName="stroke-dashoffset"
                calcMode="spline"
                dur="2s"
                values="685;-685"
                keySplines="0 0 1 1"
                repeatCount="indefinite"
              />
            </path>
          </svg>
        )}
        {status === 'permission_needed' && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500 animate-pulse" />
        )}
      </>
    )
  return (
    <Bot
      className={cn(
        'h-4 w-4 shrink-0',
        sessionStatusColor[status] ?? 'text-gray-400',
      )}
    />
  )
}

export function createSearchMode(
  data: AppData,
  _level: PaletteLevel,
  _actions: AppActions,
  api: PaletteAPI,
): PaletteMode {
  const { terminals, sessions, githubPRs, mergedPRs } = data

  // Match TerminalItem logic: prefer OPEN, fall back to MERGED
  const branchToPR = new Map<string, PRCheckStatus>()
  for (const pr of githubPRs) {
    if (pr.state !== 'OPEN' && pr.state !== 'MERGED') continue
    const existing = branchToPR.get(pr.branch)
    if (!existing || (existing.state !== 'OPEN' && pr.state === 'OPEN')) {
      branchToPR.set(pr.branch, pr)
    }
  }

  const openPRs = githubPRs.filter((pr) => pr.state === 'OPEN')

  // Build terminal items
  const terminalItems: PaletteItem[] = terminals.map((t) => {
    const matchedPR = t.git_branch
      ? (branchToPR.get(t.git_branch) ?? null)
      : null
    const prInfo = matchedPR ? getPRStatusInfo(matchedPR) : null
    return {
      id: `t:${t.id}`,
      label: t.name || getLastPathSegment(t.cwd),
      description: t.git_branch && (
        <div className="flex justify-between">
          <span className="flex items-center gap-1 truncate">
            <GitBranch className="max-h-3 max-w-3 shrink-0 text-zinc-400" />
            {t.git_branch}
          </span>
          {matchedPR && <PRTabButton pr={matchedPR} />}
        </div>
      ),
      icon: prInfo ? (
        prInfo.icon()
      ) : t.ssh_host ? (
        <Globe className="h-4 w-4 shrink-0 text-blue-400" />
      ) : (
        <TerminalSquare className="h-4 w-4 shrink-0 text-zinc-400" />
      ),
      keywords: [
        t.name ?? '',
        t.cwd,
        t.git_branch ?? '',
        t.git_repo?.repo ?? '',
      ],
      onSelect: () => {
        api.push({
          mode: 'actions',
          title: t.name || getLastPathSegment(t.cwd),
          terminal: t,
          pr: matchedPR ?? undefined,
        })
      },
      onNavigate: () => {
        api.push({
          mode: 'actions',
          title: t.name || getLastPathSegment(t.cwd),
          terminal: t,
          pr: matchedPR ?? undefined,
        })
      },
    }
  })

  // Build open PR items
  const openPRItems: PaletteItem[] = openPRs.map((pr) => {
    const prInfo = getPRStatusInfo(pr)
    return {
      id: `pr:${pr.prNumber}:${pr.repo}`,
      label: pr.prTitle,
      description: (
        <div className="flex justify-between">
          <span className="flex items-center gap-1 truncate">
            <GitBranch className="max-h-3 max-w-3 shrink-0 text-zinc-400" />
            {pr.branch}
          </span>
          <PRTabButton pr={pr} />
        </div>
      ),
      icon: prInfo.icon?.(),
      keywords: [pr.prTitle, pr.branch],
      onSelect: () => {
        api.push({
          mode: 'pr-actions',
          title: pr.prTitle,
          pr,
        })
      },
      onNavigate: () => {
        api.push({
          mode: 'pr-actions',
          title: pr.prTitle,
          pr,
        })
      },
    }
  })

  // Build merged PR items
  const mergedPRItems: PaletteItem[] = mergedPRs.map((pr) => ({
    id: `pr:${pr.prNumber}:${pr.repo}`,
    label: pr.prTitle,
    description: (
      <div className="flex justify-between">
        <span className="flex items-center gap-1 truncate">
          <GitBranch className="max-h-3 max-w-3 shrink-0 text-zinc-400" />
          {pr.branch}
        </span>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-purple-400">
          Merged
        </span>
      </div>
    ),
    icon: <GitMerge className="h-4 w-4 shrink-0 text-purple-500" />,
    keywords: [pr.prTitle, pr.branch],
    onSelect: () => window.open(pr.prUrl, '_blank'),
  }))

  // Build session items
  const sessionItems: PaletteItem[] = sessions.map((s) => ({
    id: `s:${s.session_id}`,
    label: s.name || s.latest_user_message || `Untitled in "${s.project_path}"`,
    description: s.latest_agent_message && (
      <span className="truncate">{s.latest_agent_message}</span>
    ),
    icon: <SessionIcon status={s.status} />,
    keywords: [
      s.name ?? '',
      s.latest_user_message ?? '',
      s.latest_agent_message ?? '',
    ],
    onSelect: () => {
      api.push({
        mode: 'actions',
        title: s.name || s.latest_user_message || s.session_id,
        session: s,
      })
    },
    onNavigate: () => {
      api.push({
        mode: 'actions',
        title: s.name || s.latest_user_message || s.session_id,
        session: s,
      })
    },
  }))

  // Logs action
  const logsItem: PaletteItem = {
    id: 'action:logs',
    label: 'Logs',
    description: 'View command logs',
    icon: <ScrollText className="h-4 w-4 shrink-0 text-zinc-400" />,
    keywords: ['logs', 'command', 'history'],
    onSelect: () => {
      window.dispatchEvent(new CustomEvent('open-logs'))
      api.close()
    },
  }

  // Group terminals by repo
  const terminalsByRepo = new Map<string, PaletteItem[]>()
  const terminalsNoRepo: PaletteItem[] = []
  for (let i = 0; i < terminals.length; i++) {
    const repo = terminals[i].git_repo?.repo
    if (repo) {
      const existing = terminalsByRepo.get(repo) || []
      existing.push(terminalItems[i])
      terminalsByRepo.set(repo, existing)
    } else {
      terminalsNoRepo.push(terminalItems[i])
    }
  }

  // Group PRs by repo
  const allPRItems = [...openPRItems, ...mergedPRItems]
  const prsByRepo = new Map<string, PaletteItem[]>()
  const allPRSources = [...openPRs, ...mergedPRs]
  for (let i = 0; i < allPRSources.length; i++) {
    const repo = allPRSources[i].repo
    const existing = prsByRepo.get(repo) || []
    existing.push(allPRItems[i])
    prsByRepo.set(repo, existing)
  }

  // Collect all unique repos
  const allRepos = new Set([...terminalsByRepo.keys(), ...prsByRepo.keys()])
  const needsRepoSubheadings =
    allRepos.size > 1 || (allRepos.size === 1 && terminalsNoRepo.length > 0)

  // Build groups
  const groups = []
  if (needsRepoSubheadings) {
    for (const repo of allRepos) {
      const repoName = repo.split('/')[1] || repo
      const repoTerminals = terminalsByRepo.get(repo)
      if (repoTerminals && repoTerminals.length > 0) {
        groups.push({
          heading: `Projects — ${repoName}`,
          items: repoTerminals,
        })
      }
    }
    if (terminalsNoRepo.length > 0) {
      groups.push({ heading: 'Projects', items: terminalsNoRepo })
    }
    for (const repo of allRepos) {
      const repoName = repo.split('/')[1] || repo
      const repoPRs = prsByRepo.get(repo)
      if (repoPRs && repoPRs.length > 0) {
        groups.push({
          heading: `Pull Requests — ${repoName}`,
          items: repoPRs,
        })
      }
    }
  } else {
    if (terminalItems.length > 0) {
      groups.push({ heading: 'Projects', items: terminalItems })
    }
    if (allPRItems.length > 0) {
      groups.push({ heading: 'Pull Requests', items: allPRItems })
    }
  }
  if (sessionItems.length > 0) {
    const findSessionsItem: PaletteItem = {
      id: 'action:find-sessions',
      label: 'Find',
      icon: <Search className="h-4 w-4 shrink-0 text-zinc-400" />,
      keywords: ['find sessions'],
      onSelect: () =>
        api.push({ mode: 'session-search', title: 'Find Sessions' }),
    }
    const sessionActions: PaletteItem[] = [findSessionsItem]
    if (sessions.some((s) => s.is_favorite)) {
      sessionActions.push({
        id: 'action:favorite-sessions',
        label: 'Favorite',
        icon: <Heart className="h-4 w-4 shrink-0 text-zinc-400" />,
        keywords: ['favorite sessions', 'favorites'],
        onSelect: () =>
          api.push({ mode: 'favorite-sessions', title: 'Favorite Sessions' }),
      })
    }

    // Group sessions by terminal name
    const terminalMap = new Map(terminals.map((t) => [t.id, t]))
    const sessionsByTerminal = new Map<string, PaletteItem[]>()
    for (let i = 0; i < sessions.length; i++) {
      const terminal = sessions[i].terminal_id
        ? terminalMap.get(sessions[i].terminal_id!)
        : null
      const groupName = terminal?.name || 'Not in project'
      const existing = sessionsByTerminal.get(groupName) || []
      existing.push(sessionItems[i])
      sessionsByTerminal.set(groupName, existing)
    }

    groups.push({ heading: 'Session Actions', items: sessionActions })

    const needsSessionSubheadings = sessionsByTerminal.size > 1
    if (needsSessionSubheadings) {
      const sortedEntries = [...sessionsByTerminal.entries()].sort(
        ([a], [b]) => {
          if (a === 'Not in project') return 1
          if (b === 'Not in project') return -1
          return 0
        },
      )
      for (const [name, items] of sortedEntries) {
        groups.push({ heading: `Sessions — ${name}`, items })
      }
    } else {
      groups.push({ heading: 'Claude Sessions', items: sessionItems })
    }
  }
  // Add actions group with logs
  groups.push({ heading: 'Actions', items: [logsItem] })

  return {
    id: 'search',
    placeholder: 'Search projects, PRs, Claude sessions...',
    items: [],
    groups,
    footer: () => (
      <span className="flex items-center gap-1.5 ml-auto">
        <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
          <CornerDownLeft className="h-3 w-3" />
        </kbd>
        to select
      </span>
    ),
  }
}
