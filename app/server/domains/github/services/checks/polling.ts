import { detectGitHubRepo } from '@domains/git/services/resolve'
import { detectGitBranch } from '@domains/git/services/status'
import type { PRCheckStatus } from '@domains/github/schema'
import { getSettings } from '@domains/settings/db'
import {
  getAllTerminals,
  getTerminalById,
} from '@domains/workspace/db/terminals'
import { getIO } from '@server/io'
import serverEvents from '@server/lib/events'
import { log } from '@server/logger'
import { updateGithubGraphql, updateGithubRest } from '@server/status'
import {
  checkGhAvailable,
  fetchAllPRsViaGraphQL,
  fetchGhUsername,
  ghExec,
} from './fetcher'
import { isHiddenPR, processNewPRData } from './notifications'
import {
  getActivePollId,
  getGhAvailable,
  getGhUsername,
  getGlobalChecksPollingId,
  getLastEmittedPRs,
  getLastGraphQLRateRemaining,
  getLastRESTRateRemaining,
  getLastRefreshAt,
  incrementActivePollId,
  invalidateChecksCache,
  lastPRData,
  monitoredTerminals,
  POLL_INTERVAL,
  REFRESH_MIN_INTERVAL,
  setGhAvailable,
  setGhUsername,
  setGlobalChecksPollingId,
  setLastEmittedPRs,
  setLastGraphQLRateRemaining,
  setLastRESTRateRemaining,
  setLastRefreshAt,
} from './state'

async function emitPRChecks(allPRs: PRCheckStatus[]) {
  const settings = await getSettings()
  const visiblePRs = allPRs.filter(
    (pr) => !isHiddenPR(settings.hidden_prs, pr.repo, pr.prNumber),
  )
  setLastEmittedPRs(visiblePRs)
  getIO()?.emit('github:pr-checks', {
    prs: visiblePRs,
    username: getGhUsername(),
  })
}

/** Exported for use by pr-ops that need to emit after cache mutation */
export { emitPRChecks }

async function pollAllPRChecks(force = false) {
  if (getGhAvailable() === false) return

  if (getGhUsername() === null) {
    setGhUsername(await fetchGhUsername())
  }

  // Collect unique repos and their terminal branches
  const repoData = new Map<
    string,
    { owner: string; repo: string; branches: Set<string> }
  >()

  for (const [terminalId] of monitoredTerminals) {
    try {
      const terminal = await getTerminalById(terminalId)
      if (!terminal) continue

      if (terminal.ssh_host) {
        await detectGitBranch(terminalId, { skipPRRefresh: true })
      }

      const repo = await detectGitHubRepo(terminal.cwd, terminal.ssh_host)
      if (!repo) continue

      const key = `${repo.owner}/${repo.repo}`
      const existing = repoData.get(key)
      if (existing) {
        if (terminal.git_branch) existing.branches.add(terminal.git_branch)
      } else {
        repoData.set(key, {
          owner: repo.owner,
          repo: repo.repo,
          branches: new Set(terminal.git_branch ? [terminal.git_branch] : []),
        })
      }
    } catch (err) {
      log.error(
        { err },
        `[github] Failed to detect repo for terminal ${terminalId}`,
      )
    }
  }

  const allRepos = [...repoData.keys()]
  const allBranches = new Map<string, Set<string>>()
  for (const [key, { branches }] of repoData) {
    const branchSet = allBranches.get(key) || new Set<string>()
    for (const b of branches) branchSet.add(b)
    for (const [, pr] of lastPRData) {
      if (pr.repo === key && pr.state === 'OPEN' && pr.branch) {
        branchSet.add(pr.branch)
      }
    }
    allBranches.set(key, branchSet)
  }

  let allPRs: PRCheckStatus[]
  try {
    const { openPRs, closedPRs } = await fetchAllPRsViaGraphQL(
      allRepos,
      allBranches,
      force,
    )
    allPRs = [...openPRs, ...closedPRs]
  } catch (err) {
    log.error({ err }, '[github] Failed to fetch PRs via GraphQL')
    allPRs = []
  }

  await processNewPRData(allPRs)
  await emitPRChecks(allPRs)

  // Log API rate limits
  try {
    const rlStdout = await ghExec(
      'gh',
      [
        'api',
        'rate_limit',
        '--jq',
        '{rest: .rate, graphql: .resources.graphql}',
      ],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    )
    if (rlStdout) {
      const data = JSON.parse(rlStdout) as {
        rest: { limit: number; remaining: number; reset: number }
        graphql: { limit: number; remaining: number; reset: number }
      }

      const restResetMin = Math.ceil(
        (data.rest.reset * 1000 - Date.now()) / 60000,
      )
      const lastREST = getLastRESTRateRemaining()
      const restUsed = lastREST !== null ? lastREST - data.rest.remaining : '?'
      log.info(
        `[github] REST rate limit: used=${restUsed} remaining=${data.rest.remaining}/${data.rest.limit} resets_in=${restResetMin}m`,
      )
      setLastRESTRateRemaining(data.rest.remaining)
      updateGithubRest({
        status:
          data.rest.remaining === 0
            ? 'error'
            : data.rest.remaining / data.rest.limit < 0.2
              ? 'degraded'
              : 'healthy',
        error: null,
        remaining: data.rest.remaining,
        limit: data.rest.limit,
        reset: data.rest.reset,
        usedLastCycle: typeof restUsed === 'number' ? restUsed : null,
      })

      const gqlResetMin = Math.ceil(
        (data.graphql.reset * 1000 - Date.now()) / 60000,
      )
      const lastGQL = getLastGraphQLRateRemaining()
      const gqlUsed = lastGQL !== null ? lastGQL - data.graphql.remaining : '?'
      log.info(
        `[github] GraphQL rate limit: used=${gqlUsed} remaining=${data.graphql.remaining}/${data.graphql.limit} resets_in=${gqlResetMin}m`,
      )
      setLastGraphQLRateRemaining(data.graphql.remaining)
      updateGithubGraphql({
        status:
          data.graphql.remaining === 0
            ? 'error'
            : data.graphql.remaining / data.graphql.limit < 0.2
              ? 'degraded'
              : 'healthy',
        error: null,
        remaining: data.graphql.remaining,
        limit: data.graphql.limit,
        reset: data.graphql.reset,
        usedLastCycle: typeof gqlUsed === 'number' ? gqlUsed : null,
      })
    }
  } catch (err) {
    log.error({ err }, '[github] Failed to check rate limit')
    updateGithubRest({ status: 'error', error: String(err) })
    updateGithubGraphql({ status: 'error', error: String(err) })
  }
}

interface PollUntilOptions {
  repo: string
  prNumber: number
  until: (pr: PRCheckStatus | undefined) => boolean
}

export async function refreshPRChecks(force = false, poll?: PollUntilOptions) {
  const now = Date.now()
  if (!force && now - getLastRefreshAt() < REFRESH_MIN_INTERVAL) return

  if (getGhAvailable() === null) {
    setGhAvailable(await checkGhAvailable())
  }
  if (!getGhAvailable()) return

  if (poll) {
    const myPollId = incrementActivePollId()
    for (let i = 0; i < 6; i++) {
      invalidateChecksCache()
      await pollAllPRChecks(true)
      setLastRefreshAt(Date.now())
      const match = getLastEmittedPRs().find(
        (pr) => pr.repo === poll.repo && pr.prNumber === poll.prNumber,
      )
      if (poll.until(match)) return
      if (getActivePollId() !== myPollId) return
      if (i < 5) await new Promise((r) => setTimeout(r, 1200))
    }
    return
  }

  setLastRefreshAt(now)
  await pollAllPRChecks(force)
}

export async function trackTerminal(terminalId: number) {
  const terminal = await getTerminalById(terminalId)
  if (!terminal) return

  if (getGhAvailable() === null) {
    setGhAvailable(await checkGhAvailable())
  }
  if (!getGhAvailable()) return

  monitoredTerminals.set(terminalId, terminal.cwd)
}

export function untrackTerminal(terminalId: number) {
  monitoredTerminals.delete(terminalId)
  stopChecksPolling()
}

export function startChecksPolling() {
  if (getGlobalChecksPollingId()) return
  if (monitoredTerminals.size === 0) return
  setGlobalChecksPollingId(setInterval(pollAllPRChecks, POLL_INTERVAL))
  pollAllPRChecks()
}

export function stopChecksPolling() {
  const id = getGlobalChecksPollingId()
  if (id && monitoredTerminals.size === 0) {
    clearInterval(id)
    setGlobalChecksPollingId(null)
  }
}

export function emitCachedPRChecks(socket: {
  emit: (ev: string, data: unknown) => void
}) {
  const lastEmitted = getLastEmittedPRs()
  if (lastEmitted.length > 0) {
    socket.emit('github:pr-checks', { prs: lastEmitted })
  }
}

export async function detectAllTerminalBranches() {
  log.info(
    `[github] detecting branches for ${monitoredTerminals.size} terminals`,
  )
  await Promise.all(
    [...monitoredTerminals.keys()].map((id) =>
      detectGitBranch(id, { skipPRRefresh: true }),
    ),
  )
  refreshPRChecks()
}

export async function initGitHubChecks() {
  setGhAvailable(await checkGhAvailable())
  if (!getGhAvailable()) {
    updateGithubRest({ status: 'inactive', error: 'gh CLI not available' })
    updateGithubGraphql({ status: 'inactive', error: 'gh CLI not available' })
    return
  }

  serverEvents.on('github:refresh-pr-checks', () => refreshPRChecks(true))
  serverEvents.on('pty:terminal-sessions-destroyed', ({ terminalId }) => {
    untrackTerminal(terminalId)
  })
  serverEvents.on('pty:session-created', ({ terminalId }) => {
    trackTerminal(terminalId).then(() => {
      startChecksPolling()
    })
  })

  const terminals = await getAllTerminals()
  for (const terminal of terminals) {
    monitoredTerminals.set(terminal.id, terminal.cwd)
  }

  if (monitoredTerminals.size > 0) {
    startChecksPolling()
  }
}
