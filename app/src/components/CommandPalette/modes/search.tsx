import {
  AlertTriangle,
  Bot,
  Check,
  CornerDownLeft,
  GitBranch,
  GitMerge,
  Globe,
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
      icon: t.ssh_host ? (
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
    label: s.name || s.latest_user_message || s.session_id,
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

  // Build groups
  const groups = []
  if (terminalItems.length > 0) {
    groups.push({ heading: 'Projects', items: terminalItems })
  }
  if (openPRItems.length > 0 || mergedPRItems.length > 0) {
    groups.push({
      heading: 'Pull Requests',
      items: [...openPRItems, ...mergedPRItems],
    })
  }
  if (sessionItems.length > 0) {
    groups.push({ heading: 'Claude Sessions', items: sessionItems })
  }

  return {
    id: 'search',
    placeholder: 'Search projects, PRs, Claude sessions...',
    items: [],
    groups,
    footer: () => (
      <div className="flex h-9 items-center justify-end border-t border-zinc-700 px-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <kbd className="inline-flex items-center rounded bg-zinc-800 p-1 text-zinc-400">
            <CornerDownLeft className="h-3 w-3" />
          </kbd>
          to select
        </span>
      </div>
    ),
  }
}
