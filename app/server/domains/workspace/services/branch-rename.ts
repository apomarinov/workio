import { getSettings, updateSettings } from '@domains/settings/db'
import {
  getTerminalById,
  updateTerminal,
} from '@domains/workspace/db/terminals'
import pool from '@server/db'
import serverEvents from '@server/lib/events'
import { log } from '@server/logger'

async function renameBranchReferences(
  terminalId: number,
  oldName: string,
  newName: string,
) {
  // 1. Rename snapshot key in terminal settings
  const terminal = await getTerminalById(terminalId)
  if (terminal?.settings?.snapshots?.[oldName]) {
    const snapshots = { ...terminal.settings.snapshots }
    snapshots[newName] = snapshots[oldName]
    delete snapshots[oldName]
    await updateTerminal(terminalId, {
      settings: { ...terminal.settings, snapshots },
    })
  }

  // 2. Rename branch in sessions for this terminal
  const { rows: sessions } = await pool.query<{
    session_id: string
    data: { branch?: string; branches?: { branch: string; repo: string }[] }
  }>(
    `SELECT session_id, data FROM sessions
     WHERE terminal_id = $1 AND data IS NOT NULL
       AND (data->>'branch' = $2 OR data->'branches' @> $3::jsonb)`,
    [terminalId, oldName, JSON.stringify([{ branch: oldName }])],
  )

  for (const session of sessions) {
    const data = { ...session.data }
    if (data.branch === oldName) {
      data.branch = newName
    }
    if (data.branches) {
      data.branches = data.branches.map((b) =>
        b.branch === oldName ? { ...b, branch: newName } : b,
      )
    }
    await pool.query('UPDATE sessions SET data = $1 WHERE session_id = $2', [
      JSON.stringify(data),
      session.session_id,
    ])
  }

  // 3. Rename in starred_branches (scoped to terminal's repo)
  if (terminal?.git_repo?.repo) {
    const settings = await getSettings()
    const starred = settings.starred_branches
    const repo = terminal.git_repo.repo
    if (starred?.[repo]?.includes(oldName)) {
      const updated = starred[repo].map((b: string) =>
        b === oldName ? newName : b,
      )
      await updateSettings({
        starred_branches: { ...starred, [repo]: updated },
      })
    }
  }

  log.info({ terminalId, oldName, newName }, '[git] Renamed branch references')
}

serverEvents.on('git:branch-renamed', ({ terminalId, oldName, newName }) => {
  renameBranchReferences(terminalId, oldName, newName).catch((err) =>
    log.error(
      { err },
      `[workspace] Failed to rename branch references: ${oldName} → ${newName}`,
    ),
  )
})
