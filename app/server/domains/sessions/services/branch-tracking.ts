import { detectBranch } from '@domains/git/services/branch-detection'
import { log } from '@server/logger'
import type { Server as SocketIOServer } from 'socket.io'
import { getSessionById, updateSessionData } from '../db'

/**
 * Detects the git branch for a session and tracks it in the
 * session's branch history so the UI can show which branches were used.
 */
export async function detectSessionBranch(
  io: SocketIOServer,
  sessionId: string,
  terminalId: number | null,
  projectPath: string,
) {
  try {
    const result = await detectBranch(terminalId, projectPath)
    if (!result) return

    const { branch, repo } = result

    // Build unique branches list
    const existing = await getSessionById(sessionId)
    let branches = existing?.data?.branches ?? []

    // Backfill old branch if it was set before branches tracking existed
    const oldBranch = existing?.data?.branch
    if (oldBranch && !branches.some((e) => e.branch === oldBranch)) {
      branches = [...branches, { branch: oldBranch, repo }]
    }

    if (!branches.some((e) => e.branch === branch && e.repo === repo)) {
      branches = [...branches, { branch, repo }]
    }

    const data = { branch, repo, branches }
    await updateSessionData(sessionId, data)
    io.emit('session:updated', { sessionId, data })
    log.info(
      `[branch-tracking] Detected branch="${branch}" repo="${repo}" for session=${sessionId}`,
    )
  } catch (err) {
    log.error(
      { err, sessionId },
      '[branch-tracking] Failed to detect branch for session',
    )
  }
}
