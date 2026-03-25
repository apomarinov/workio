import type { PRCheckStatus } from '@domains/github/schema'

// --- Constants ---

export const POLL_INTERVAL = 60_000 // 60 seconds
export const CACHE_TTL = 30_000 // 30 seconds
export const REFRESH_MIN_INTERVAL = 30_000 // 30 seconds
export const WEBHOOK_THROTTLE_MS = 2000 // 2 seconds

// --- Module-level state ---

/** Cache: cwd -> { owner, repo } or null */
export const repoCache = new Map<
  string,
  { owner: string; repo: string } | null
>()

/** Monitored terminals: terminalId -> cwd */
export const monitoredTerminals = new Map<number, string>()

/** Cached PR data from last fetch */
let lastFetchedPRs: PRCheckStatus[] = []
let lastFetchedAt = 0

/** Last PRs emitted to clients (after hidden filter) */
let lastEmittedPRs: PRCheckStatus[] = []

/** Previous PR state for notification diffing */
export const lastPRData = new Map<string, PRCheckStatus>()

/** Track commits with failed checks to suppress false checks_passed notifications */
export const checkFailedOnCommit = new Map<string, string>()

/** Whether the first full fetch has completed (skip notifications on initial load) */
let initialFullFetchDone = false

/** GitHub CLI availability and username */
let ghAvailable: boolean | null = null
let ghUsername: string | null = null

/** Polling interval handle */
let globalChecksPollingId: NodeJS.Timeout | null = null

/** Rate limit tracking between polls */
let lastRESTRateRemaining: number | null = null
let lastGraphQLRateRemaining: number | null = null

/** Throttle rapid refreshes */
let lastRefreshAt = 0

/** Monotonic poll ID for cancellation */
let activePollId = 0

/** Webhook refresh throttle queue */
export const webhookQueue = {
  pendingRepos: new Set<string>(),
  timer: null as NodeJS.Timeout | null,
}

// --- Getters / Setters ---

export function getLastFetchedPRs() {
  return lastFetchedPRs
}
export function setLastFetchedPRs(prs: PRCheckStatus[]) {
  lastFetchedPRs = prs
}

export function getLastFetchedAt() {
  return lastFetchedAt
}
export function setLastFetchedAt(t: number) {
  lastFetchedAt = t
}

export function invalidateChecksCache() {
  lastFetchedAt = 0
}

export function getLastEmittedPRs() {
  return lastEmittedPRs
}
export function setLastEmittedPRs(prs: PRCheckStatus[]) {
  lastEmittedPRs = prs
}

export function getInitialFullFetchDone() {
  return initialFullFetchDone
}
export function setInitialFullFetchDone(v: boolean) {
  initialFullFetchDone = v
}

export function getGhAvailable() {
  return ghAvailable
}
export function setGhAvailable(v: boolean | null) {
  ghAvailable = v
}

export function getGhUsername() {
  return ghUsername
}
export function setGhUsername(v: string | null) {
  ghUsername = v
}

export function getGlobalChecksPollingId() {
  return globalChecksPollingId
}
export function setGlobalChecksPollingId(v: NodeJS.Timeout | null) {
  globalChecksPollingId = v
}

export function getLastRESTRateRemaining() {
  return lastRESTRateRemaining
}
export function setLastRESTRateRemaining(v: number | null) {
  lastRESTRateRemaining = v
}

export function getLastGraphQLRateRemaining() {
  return lastGraphQLRateRemaining
}
export function setLastGraphQLRateRemaining(v: number | null) {
  lastGraphQLRateRemaining = v
}

export function getLastRefreshAt() {
  return lastRefreshAt
}
export function setLastRefreshAt(v: number) {
  lastRefreshAt = v
}

export function getActivePollId() {
  return activePollId
}
export function incrementActivePollId() {
  return ++activePollId
}
