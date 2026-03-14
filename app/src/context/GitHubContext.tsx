import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import useSWR from 'swr'
import { toast } from '@/components/ui/sonner'
import type {
  InvolvedPRSummary,
  MergedPRSummary,
  PRCheckStatus,
  PRChecksPayload,
  PRReaction,
} from '../../shared/types'
import { useSocket } from '../hooks/useSocket'
import * as api from '../lib/api'
import { useWorkspaceContext } from './WorkspaceContext'

const RECENT_PR_THRESHOLD_MS = 15 * 60 * 1000

const UNREAD_PR_KEY = '/api/notifications/pr-unread'

async function fetchUnreadPRData() {
  const data = await api.getUnreadPRNotifications()
  const map = new Map<string, { count: number; itemIds: Set<string> }>()
  for (const item of data) {
    const key = `${item.repo}#${item.prNumber}`
    const itemIds = new Set<string>()
    for (const i of item.items) {
      if (i.commentId) itemIds.add(String(i.commentId))
      if (i.reviewId) itemIds.add(String(i.reviewId))
    }
    map.set(key, { count: item.count, itemIds })
  }
  return map
}

interface GitHubContextValue {
  ghUsername: string | null
  githubPRs: PRCheckStatus[]
  mergedPRs: MergedPRSummary[]
  involvedPRs: InvolvedPRSummary[]
  activePR: PRCheckStatus | null
  setActivePR: (pr: PRCheckStatus | null) => void
  reactToPR: (
    repo: string,
    prNumber: number,
    subjectId: number,
    subjectType: 'issue_comment' | 'review_comment' | 'review',
    content: string,
    remove: boolean,
  ) => Promise<void>
  hasAnyUnseenPRs: boolean
}

const GitHubContext = createContext<GitHubContextValue | null>(null)

export function GitHubProvider({ children }: { children: React.ReactNode }) {
  const { subscribe, emit } = useSocket()
  const { terminals } = useWorkspaceContext()

  // GitHub PR checks
  const [ghUsername, setGhUsername] = useState<string | null>(null)
  const [githubPRs, setGithubPRs] = useState<PRCheckStatus[]>([])
  const [activePR, setActivePR] = useState<PRCheckStatus | null>(null)
  const [prPoll, setPrPoll] = useState(true)
  const lastDetectEmitRef = useRef(0)

  // Unread PR data via SWR (shared cache key with NotificationDataContext)
  const { data: unreadPRData = new Map() } = useSWR(
    UNREAD_PR_KEY,
    fetchUnreadPRData,
  )

  useEffect(() => {
    if (!prPoll) {
      return
    }
    const now = Date.now()
    if (now - lastDetectEmitRef.current < 30_000) {
      return
    }
    const recentPR = githubPRs
      .filter(
        (pr) =>
          pr.createdAt &&
          now - new Date(pr.createdAt).getTime() < RECENT_PR_THRESHOLD_MS,
      )
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0]
    if (recentPR) {
      const terminalBranches = new Set(
        terminals.map((t) => t.git_branch).filter(Boolean),
      )
      if (!terminalBranches.has(recentPR.branch)) {
        setPrPoll(false)
        lastDetectEmitRef.current = now
        emit('detect-branches')
      }
    }
  }, [githubPRs, prPoll, terminals, emit])

  // Subscribe to PR checks updates
  useEffect(() => {
    return subscribe<PRChecksPayload>('github:pr-checks', (data) => {
      setGithubPRs(data.prs)
      if (data.username) setGhUsername(data.username)
      setPrPoll(true)
    })
  }, [subscribe])

  // Enrich githubPRs with unread notification status
  const enrichedGithubPRs = useMemo(() => {
    if (unreadPRData.size === 0) return githubPRs
    return githubPRs.map((pr) => {
      const key = `${pr.repo}#${pr.prNumber}`
      const unread = unreadPRData.get(key)
      if (!unread) return pr
      const ids = unread.itemIds
      const markComment = (c: (typeof pr.comments)[0]) =>
        c.id && ids.has(String(c.id)) ? { ...c, isUnread: true } : c
      const markReview = (r: (typeof pr.reviews)[0]) =>
        r.id && ids.has(String(r.id)) ? { ...r, isUnread: true } : r
      return {
        ...pr,
        hasUnreadNotifications: true,
        comments: pr.comments.map(markComment),
        reviews: pr.reviews.map(markReview),
        discussion: pr.discussion.map((item) => {
          if (item.type === 'comment') {
            return { ...item, comment: markComment(item.comment) }
          }
          if (item.type === 'review') {
            return {
              ...item,
              review: markReview(item.review),
              threads: item.threads.map((t) => ({
                ...t,
                comments: t.comments.map(markComment),
              })),
            }
          }
          if (item.type === 'thread') {
            return {
              ...item,
              thread: {
                ...item.thread,
                comments: item.thread.comments.map(markComment),
              },
            }
          }
          return item
        }),
      }
    })
  }, [githubPRs, unreadPRData])

  const hasAnyUnseenPRs = unreadPRData.size > 0

  // Fetch merged PRs for all repos
  const [mergedPRs, setMergedPRs] = useState<MergedPRSummary[]>([])

  const repos = useMemo(() => {
    const repoSet = new Set<string>()
    for (const pr of githubPRs) {
      repoSet.add(pr.repo)
    }
    return Array.from(repoSet)
  }, [githubPRs])

  useEffect(() => {
    if (repos.length === 0) {
      setMergedPRs([])
      return
    }

    let cancelled = false

    async function fetchMergedPRs() {
      try {
        const limit = Math.min(repos.length * 10, 100)
        const prs = await api.getClosedPRs(repos, limit)

        if (!cancelled) {
          const existingPRs = new Set(
            githubPRs.map((pr) => `${pr.repo}#${pr.prNumber}`),
          )
          const seen = new Set<string>()
          const allPRs: MergedPRSummary[] = []
          for (const pr of prs) {
            const key = `${pr.repo}#${pr.prNumber}`
            if (!seen.has(key) && !existingPRs.has(key)) {
              seen.add(key)
              allPRs.push(pr)
            }
          }
          setMergedPRs(allPRs)
        }
      } catch {
        toast.error('Failed to fetch merged PRs')
      }
    }

    fetchMergedPRs()

    return () => {
      cancelled = true
    }
  }, [repos, githubPRs])

  // Fetch involved PRs (review-requested / mentioned) for all repos
  const [involvedPRs, setInvolvedPRs] = useState<InvolvedPRSummary[]>([])

  useEffect(() => {
    if (repos.length === 0) {
      setInvolvedPRs([])
      return
    }

    let cancelled = false

    async function fetchInvolvedPRs() {
      try {
        const limit = Math.min(repos.length * 10, 100)
        const prs = await api.getInvolvedPRs(repos, limit)
        if (!cancelled) {
          setInvolvedPRs(prs)
        }
      } catch {
        toast.error('Failed to fetch involved PRs')
      }
    }

    fetchInvolvedPRs()

    return () => {
      cancelled = true
    }
  }, [repos])

  const updatePRReaction = useCallback(
    (
      repo: string,
      prNumber: number,
      subjectId: number,
      subjectType: 'issue_comment' | 'review_comment' | 'review',
      content: string,
      remove: boolean,
    ) => {
      setGithubPRs((prev) =>
        prev.map((pr) => {
          if (pr.repo !== repo || pr.prNumber !== prNumber) return pr

          const patchReactions = (
            reactions: PRReaction[] | undefined,
          ): PRReaction[] | undefined => {
            const result = (reactions || []).map((r) => ({
              ...r,
              users: [...r.users],
            }))
            const idx = result.findIndex((r) => r.content === content)
            if (remove) {
              if (idx >= 0 && result[idx].viewerHasReacted) {
                result[idx].count--
                result[idx].viewerHasReacted = false
                result[idx].users = result[idx].users.filter(
                  (u) => u !== ghUsername,
                )
                if (result[idx].count <= 0) result.splice(idx, 1)
              }
            } else {
              if (idx >= 0) {
                if (!result[idx].viewerHasReacted) {
                  result[idx].count++
                  result[idx].viewerHasReacted = true
                  if (ghUsername) result[idx].users.push(ghUsername)
                }
              } else {
                result.push({
                  content,
                  count: 1,
                  viewerHasReacted: true,
                  users: ghUsername ? [ghUsername] : [],
                })
              }
            }
            return result.length > 0 ? result : undefined
          }

          const patchComment = <
            T extends { id?: number; reactions?: PRReaction[] },
          >(
            c: T,
          ): T =>
            c.id === subjectId
              ? { ...c, reactions: patchReactions(c.reactions) }
              : c

          if (subjectType === 'review') {
            return {
              ...pr,
              reviews: pr.reviews.map((r) =>
                r.id === subjectId
                  ? { ...r, reactions: patchReactions(r.reactions) }
                  : r,
              ),
              discussion: pr.discussion.map((item) => {
                if (item.type === 'review' && item.review.id === subjectId) {
                  return {
                    ...item,
                    review: {
                      ...item.review,
                      reactions: patchReactions(item.review.reactions),
                    },
                  }
                }
                return item
              }),
            }
          }

          return {
            ...pr,
            comments: pr.comments.map(patchComment),
            discussion: pr.discussion.map((item) => {
              if (item.type === 'comment' && item.comment.id === subjectId) {
                return { ...item, comment: patchComment(item.comment) }
              }
              if (item.type === 'review') {
                return {
                  ...item,
                  threads: item.threads.map((thread) => ({
                    ...thread,
                    comments: thread.comments.map(patchComment),
                  })),
                }
              }
              if (item.type === 'thread') {
                return {
                  ...item,
                  thread: {
                    ...item.thread,
                    comments: item.thread.comments.map(patchComment),
                  },
                }
              }
              return item
            }),
          }
        }),
      )
    },
    [ghUsername],
  )

  const reactToPR = useCallback(
    async (
      repo: string,
      prNumber: number,
      subjectId: number,
      subjectType: 'issue_comment' | 'review_comment' | 'review',
      content: string,
      remove: boolean,
    ) => {
      updatePRReaction(repo, prNumber, subjectId, subjectType, content, remove)

      const [owner, repoName] = repo.split('/')
      const prNum = subjectType === 'review' ? prNumber : undefined
      try {
        if (remove) {
          await api.removeReaction(
            owner,
            repoName,
            subjectId,
            subjectType,
            content,
            prNum,
          )
        } else {
          await api.addReaction(
            owner,
            repoName,
            subjectId,
            subjectType,
            content,
            prNum,
          )
        }
      } catch (err) {
        updatePRReaction(
          repo,
          prNumber,
          subjectId,
          subjectType,
          content,
          !remove,
        )
        throw err
      }
    },
    [updatePRReaction],
  )

  const value = useMemo(
    () => ({
      ghUsername,
      githubPRs: enrichedGithubPRs,
      mergedPRs,
      involvedPRs,
      activePR,
      setActivePR,
      reactToPR,
      hasAnyUnseenPRs,
    }),
    [
      ghUsername,
      enrichedGithubPRs,
      mergedPRs,
      involvedPRs,
      activePR,
      reactToPR,
      hasAnyUnseenPRs,
    ],
  )

  return (
    <GitHubContext.Provider value={value}>{children}</GitHubContext.Provider>
  )
}

export function useGitHubContext() {
  const context = useContext(GitHubContext)
  if (!context) {
    throw new Error('useGitHubContext must be used within GitHubProvider')
  }
  return context
}
