import crypto from 'node:crypto'
import pool from '@server/db'
import { buildSetClauses, jsonOrNull } from '@server/lib/db'
import { sanitizeName, shellEscape } from '@server/lib/strings'
import { renameZellijSession, writeTerminalNameFile } from '@server/pty/manager'
import type { Project, Shell, Terminal } from '../schema'

async function attachShellsToTerminals(terminals: Terminal[]) {
  if (terminals.length === 0) return terminals
  const ids = terminals.map((t) => t.id)
  const { rows: shells } = await pool.query<Shell>(
    'SELECT * FROM shells WHERE terminal_id = ANY($1) ORDER BY id',
    [ids],
  )
  const shellsByTerminal = new Map<number, Shell[]>()
  for (const s of shells) {
    const list = shellsByTerminal.get(s.terminal_id) || []
    list.push(s)
    shellsByTerminal.set(s.terminal_id, list)
  }
  for (const t of terminals) {
    t.shells = shellsByTerminal.get(t.id) || []
  }
  return terminals
}

export async function getAllTerminals() {
  const { rows } = await pool.query<Terminal>(`
    SELECT * FROM terminals
    ORDER BY created_at DESC
  `)
  return attachShellsToTerminals(rows)
}

export async function getTerminalById(id: number) {
  const { rows } = await pool.query<Terminal>(
    `SELECT * FROM terminals WHERE id = $1`,
    [id],
  )
  if (rows.length === 0) return undefined
  const [terminal] = await attachShellsToTerminals(rows)
  return terminal
}

// Generate unique terminal name by appending -1, -2, etc. if name exists
async function getUniqueTerminalName(baseName: string, excludeId?: number) {
  let name = baseName
  let suffix = 1
  while (suffix < 200) {
    const { rows } = await pool.query(
      excludeId
        ? 'SELECT id FROM terminals WHERE name = $1 AND id != $2'
        : 'SELECT id FROM terminals WHERE name = $1',
      excludeId ? [name, excludeId] : [name],
    )
    if (rows.length === 0) return name
    name = `${baseName}-${suffix++}`
  }
  return `${baseName}-${crypto.randomUUID().slice(0, 4)}`
}

export async function terminalCwdExists(cwd: string) {
  const { rows } = await pool.query(
    'SELECT id FROM terminals WHERE cwd = $1 LIMIT 1',
    [cwd],
  )
  return rows.length > 0
}

export async function terminalNameExists(name: string, excludeId?: number) {
  const { rows } = await pool.query(
    excludeId
      ? 'SELECT id FROM terminals WHERE name = $1 AND id != $2'
      : 'SELECT id FROM terminals WHERE name = $1',
    excludeId ? [name, excludeId] : [name],
  )
  return rows.length > 0
}

export async function createTerminal(
  cwd: string,
  name: string | null,
  shell: string | null = null,
  ssh_host: string | null = null,
  git_repo: object | null = null,
  setup: object | null = null,
  settings: object | null = null,
) {
  // Auto-generate unique name if provided
  const uniqueName = name ? await getUniqueTerminalName(name) : null

  const { rows } = await pool.query<Terminal>(
    `
    INSERT INTO terminals (cwd, name, shell, ssh_host, git_repo, setup, settings)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
    [
      cwd,
      uniqueName,
      shell,
      ssh_host,
      git_repo ? JSON.stringify(git_repo) : null,
      setup ? JSON.stringify(setup) : null,
      settings ? JSON.stringify(settings) : null,
    ],
  )
  const terminal = rows[0]

  // Auto-create main shell
  const { rows: shellRows } = await pool.query<Shell>(
    `INSERT INTO shells (terminal_id, name) VALUES ($1, 'main') RETURNING *`,
    [terminal.id],
  )
  terminal.shells = shellRows

  return terminal
}

export async function updateTerminal(
  id: number,
  updates: {
    name?: string
    cwd?: string
    pid?: number | null
    status?: string
    git_branch?: string | null
    git_repo?: object | null
    setup?: object | null
    settings?: object | null
  },
) {
  // Get old terminal if name is changing (for zellij session rename)
  let oldName: string | null = null
  if (updates.name !== undefined) {
    const oldTerminal = await getTerminalById(id)
    oldName = oldTerminal?.name || null
  }

  const set = buildSetClauses({
    name: updates.name,
    cwd: updates.cwd,
    pid: updates.pid,
    status: updates.status,
    git_branch: updates.git_branch,
    git_repo: jsonOrNull(updates.git_repo),
    setup: jsonOrNull(updates.setup),
    settings: jsonOrNull(updates.settings),
  })

  if (!set) return getTerminalById(id)

  set.values.push(id)
  await pool.query(
    `UPDATE terminals SET ${set.sql} WHERE id = $${set.nextParam}`,
    set.values,
  )

  // Handle name change: update file and rename zellij session
  if (updates.name !== undefined) {
    const newName = updates.name
    const sanitizedName = sanitizeName(newName)
    const terminal = await getTerminalById(id)

    writeTerminalNameFile(id, newName)
    // Also write name file on remote host for SSH terminals (fire-and-forget)
    if (terminal?.ssh_host) {
      import('@server/ssh/pool').then(({ poolExecSSHCommand }) => {
        poolExecSSHCommand(
          terminal.ssh_host!,
          `mkdir -p ~/.workio/terminals && printf '%s' ${shellEscape(sanitizedName)} > ~/.workio/terminals/${id}`,
          { timeout: 5000 },
        ).catch(() => {})
      })
    }

    // Rename zellij session if it exists (local or SSH)
    if (oldName && oldName !== newName) {
      renameZellijSession(
        sanitizeName(oldName),
        sanitizedName,
        terminal?.ssh_host,
      )
    }
  }

  return getTerminalById(id)
}

export async function deleteTerminal(id: number) {
  // shells are deleted via ON DELETE CASCADE
  const result = await pool.query('DELETE FROM terminals WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

// Project queries

export async function getProjectByPath(cwd: string, host = 'local') {
  const { rows } = await pool.query<Project>(
    'SELECT * FROM projects WHERE host = $1 AND path = $2',
    [host, cwd],
  )
  return rows[0]
}

export async function upsertProject(projectPath: string, host = 'local') {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO projects (host, path) VALUES ($1, $2)
     ON CONFLICT (host, path) DO UPDATE SET path = EXCLUDED.path
     RETURNING id`,
    [host, projectPath],
  )
  return rows[0].id
}
