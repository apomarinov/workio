import fs from 'node:fs'
import path from 'node:path'
import type { DirEntry, DirResult } from '@domains/workspace/schema/system'
import {
  listDirectoriesInput,
  PAGE_SIZE,
  sshHostInput,
} from '@domains/workspace/schema/system'
import {
  getParentAppNameCached,
  parseShells,
} from '@domains/workspace/services/system'
import { expandPath, shellEscape } from '@server/lib/strings'
import { listSSHHosts, validateSSHHost } from '@server/ssh/config'
import { execSSHCommandLogged } from '@server/ssh/exec'
import { publicProcedure } from '@server/trpc'
import { z } from 'zod'

export const sshHosts = publicProcedure.query(() => {
  return listSSHHosts()
})

export const sshAudit = publicProcedure
  .input(sshHostInput)
  .query(async ({ input }) => {
    const validation = validateSSHHost(input.host)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
    try {
      const { stdout } = await execSSHCommandLogged(
        input.host,
        "sshd -T 2>/dev/null | grep -i '^maxsessions'",
        { category: 'workspace', errorOnly: true, timeout: 5000 },
      )
      const match = stdout.trim().match(/^maxsessions\s+(\d+)$/i)
      return { maxSessions: match ? Number(match[1]) : null }
    } catch {
      return { maxSessions: null }
    }
  })

export const listShells = publicProcedure
  .input(z.object({ host: z.string().optional() }))
  .query(async ({ input }) => {
    if (input.host) {
      const validation = validateSSHHost(input.host)
      if (!validation.valid) throw new Error(validation.error)
      const { stdout } = await execSSHCommandLogged(
        input.host,
        'echo "LOGIN:$SHELL" && cat /etc/shells 2>/dev/null',
        { category: 'workspace', errorOnly: true, timeout: 5000 },
      )
      return parseShells(stdout)
    }
    const loginShell = process.env.SHELL || null
    const content = await fs.promises
      .readFile('/etc/shells', 'utf-8')
      .catch(() => '')
    return parseShells(`LOGIN:${loginShell}\n${content}`)
  })

export const listDirectories = publicProcedure
  .input(listDirectoriesInput)
  .mutation(async ({ input }) => {
    const { paths, page, hidden, ssh_host } = input
    const results: Record<string, DirResult> = {}

    if (ssh_host) {
      const validation = validateSSHHost(ssh_host)
      if (!validation.valid) {
        return {
          results: Object.fromEntries(
            paths.map((p) => [p, { error: validation.error } as DirResult]),
          ),
        }
      }
    }

    await Promise.all(
      paths.map(async (rawPath) => {
        try {
          if (ssh_host) {
            const flags = hidden ? '-1ap' : '-1p'
            // Expand ~ on the remote side since shellEscape prevents tilde expansion
            const remotePath =
              rawPath === '~'
                ? '$HOME'
                : rawPath.startsWith('~/')
                  ? `$HOME/${rawPath.slice(2)}`
                  : shellEscape(rawPath)
            const { stdout } = await execSSHCommandLogged(
              ssh_host,
              `ls ${flags} ${remotePath}`,
              { category: 'workspace', errorOnly: true },
            )
            const lines = stdout
              .split('\n')
              .filter((l) => l && l !== './' && l !== '../')

            const allEntries: DirEntry[] = lines.map((line) => {
              const isDir = line.endsWith('/')
              return {
                name: isDir ? line.slice(0, -1) : line,
                isDir,
              }
            })

            allEntries.sort((a, b) => {
              const aDir = a.isDir ? 0 : 1
              const bDir = b.isDir ? 0 : 1
              if (aDir !== bDir) return aDir - bDir
              return a.name.localeCompare(b.name)
            })

            const start = page * PAGE_SIZE
            const paged = allEntries.slice(start, start + PAGE_SIZE)
            const hasMore = start + PAGE_SIZE < allEntries.length

            // Check which directories are git repos
            const dirs = paged.filter((e) => e.isDir)
            if (dirs.length > 0) {
              const remoteDirPath =
                rawPath === '~'
                  ? '$HOME'
                  : rawPath.startsWith('~/')
                    ? `$HOME/${rawPath.slice(2)}`
                    : shellEscape(rawPath)
              const checks = dirs
                .map(
                  (d) =>
                    `[ -d ${remoteDirPath}/${shellEscape(d.name)}/.git ] && echo ${shellEscape(d.name)}`,
                )
                .join('; ')
              try {
                const { stdout: gitOut } = await execSSHCommandLogged(
                  ssh_host,
                  checks,
                  { category: 'workspace', errorOnly: true, timeout: 5000 },
                )
                const gitDirs = new Set(gitOut.split('\n').filter(Boolean))
                for (const d of dirs) {
                  if (gitDirs.has(d.name)) d.isGit = true
                }
              } catch {
                // ignore - git detection is best-effort
              }
            }

            results[rawPath] = { entries: paged, hasMore, error: null }
          } else {
            const dirPath = expandPath(rawPath)
            const entries = await fs.promises.readdir(dirPath, {
              withFileTypes: true,
            })

            const filtered = entries.filter((e) => {
              if (!hidden && e.name.startsWith('.')) return false
              return true
            })

            filtered.sort((a, b) => {
              const aDir = a.isDirectory() ? 0 : 1
              const bDir = b.isDirectory() ? 0 : 1
              if (aDir !== bDir) return aDir - bDir
              return a.name.localeCompare(b.name)
            })

            const start = page * PAGE_SIZE
            const paged = filtered.slice(start, start + PAGE_SIZE)
            const hasMore = start + PAGE_SIZE < filtered.length

            const dirEntries: DirEntry[] = await Promise.all(
              paged.map(async (e) => {
                const isDir = e.isDirectory()
                const entry: DirEntry = { name: e.name, isDir }
                if (isDir) {
                  entry.isGit = await fs.promises
                    .access(path.join(dirPath, e.name, '.git'))
                    .then(
                      () => true,
                      () => false,
                    )
                }
                return entry
              }),
            )

            results[rawPath] = {
              entries: dirEntries,
              hasMore,
              error: null,
            }
          }
        } catch (err) {
          const isPermissionError =
            err instanceof Error &&
            (err as NodeJS.ErrnoException).code === 'EPERM'
          const appName = isPermissionError
            ? await getParentAppNameCached()
            : null
          results[rawPath] = {
            error: isPermissionError
              ? `permission_denied:${appName ?? ''}`
              : err instanceof Error
                ? err.message
                : 'Failed to list directory',
          }
        }
      }),
    )

    return { results }
  })
