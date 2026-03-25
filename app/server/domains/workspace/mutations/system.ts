import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getTerminalById } from '@domains/workspace/db/terminals'
import {
  createDirectoryInput,
  openInExplorerInput,
  openInIdeInput,
  sshHostInput,
} from '@domains/workspace/schema/system'
import { expandPath, shellEscape } from '@server/lib/strings'
import { log } from '@server/logger'
import { validateSSHHost } from '@server/ssh/config'
import { execSSHCommand } from '@server/ssh/exec'
import { publicProcedure } from '@server/trpc'

export const browseFolder = publicProcedure.mutation(() => {
  return new Promise<{ path: string } | null>((resolve) => {
    execFile(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Select a folder")'],
      { timeout: 60000 },
      (err, stdout) => {
        if (err) {
          resolve(null)
        } else {
          resolve({ path: stdout.trim().replace(/\/$/, '') })
        }
      },
    )
  })
})

export const openFullDiskAccess = publicProcedure.mutation(() => {
  if (process.platform !== 'darwin') {
    throw new Error('Only supported on macOS')
  }
  return new Promise<null>((resolve, reject) => {
    execFile(
      'open',
      [
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      ],
      (err) => {
        if (err) reject(new Error('Failed to open System Settings'))
        else resolve(null)
      },
    )
  })
})

export const openInIde = publicProcedure
  .input(openInIdeInput)
  .mutation(async ({ input }) => {
    const { path: rawPath, ide, terminal_id, ssh_host } = input

    const cmd = ide === 'vscode' ? 'code' : 'cursor'

    // Strip :line:col suffix for existence check (IDE CLIs handle file:line:col)
    const lineColMatch = rawPath.match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/)
    const pathOnly = lineColMatch ? lineColMatch[1] : rawPath

    // Resolve path against terminal cwd if terminal_id is provided
    let resolvedPath = pathOnly
    let terminalCwd: string | null = null
    let remoteSshHost: string | undefined = ssh_host
    if (terminal_id != null) {
      const terminal = await getTerminalById(terminal_id)
      if (terminal) {
        terminalCwd = terminal.cwd
        if (terminal.ssh_host) remoteSshHost = terminal.ssh_host
        if (!pathOnly.startsWith('/') && !pathOnly.startsWith('~')) {
          resolvedPath = `${terminal.cwd}/${pathOnly}`
        }
      }
    }

    // Skip file existence check for SSH remotes (file is on the remote host)
    if (!remoteSshHost) {
      try {
        await fs.promises.access(expandPath(resolvedPath))
      } catch {
        throw new Error('File not found')
      }
    }

    // Build full target path with :line:col for the IDE CLI
    const finalPath = lineColMatch?.[2]
      ? `${resolvedPath}:${lineColMatch[2]}${lineColMatch[3] ? `:${lineColMatch[3]}` : ''}`
      : resolvedPath
    const targetPath = remoteSshHost ? finalPath : expandPath(finalPath)

    // Build args — for SSH remotes, use --remote to open via the IDE's SSH extension
    let args: string[]
    if (remoteSshHost) {
      args = terminalCwd
        ? [
            '--remote',
            `ssh-remote+${remoteSshHost}`,
            terminalCwd,
            '--goto',
            targetPath,
          ]
        : ['--remote', `ssh-remote+${remoteSshHost}`, '--goto', targetPath]
    } else {
      args = terminalCwd
        ? [terminalCwd, '--goto', targetPath]
        : ['--goto', targetPath]
    }

    return new Promise<null>((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000 }, (err) => {
        if (err) {
          reject(new Error(`Failed to open ${cmd}: ${err.message}`))
        } else {
          resolve(null)
        }
      })
    })
  })

export const openInExplorer = publicProcedure
  .input(openInExplorerInput)
  .mutation(async ({ input }) => {
    const { path: rawPath, terminal_id } = input

    // Strip :line:col suffix (not relevant for file explorer)
    const pathOnly = rawPath.replace(/:\d+(?::\d+)?$/, '')

    // Resolve relative paths against terminal cwd
    let resolvedPath = pathOnly
    if (terminal_id != null) {
      const terminal = await getTerminalById(terminal_id)
      if (terminal && !pathOnly.startsWith('/') && !pathOnly.startsWith('~')) {
        resolvedPath = `${terminal.cwd}/${pathOnly}`
      }
    }

    const targetPath = expandPath(resolvedPath)

    if (!fs.existsSync(targetPath)) {
      throw new Error(`File not found: ${targetPath}`)
    }

    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args =
      process.platform === 'darwin' ? ['-R', targetPath] : [targetPath]

    return new Promise<null>((resolve, reject) => {
      execFile(cmd, args, (err) => {
        if (err) reject(new Error('Failed to open file explorer'))
        else resolve(null)
      })
    })
  })

export const createDirectory = publicProcedure
  .input(createDirectoryInput)
  .mutation(async ({ input }) => {
    const { path: parentPath, name, ssh_host } = input

    if (name.includes('/') || name.includes('\\')) {
      throw new Error('Folder name cannot contain path separators')
    }

    if (ssh_host) {
      const validation = validateSSHHost(ssh_host)
      if (!validation.valid) {
        throw new Error(validation.error)
      }
      const fullPath = `${parentPath}/${name}`
      const remotePath = fullPath.startsWith('~/')
        ? `"$HOME/${fullPath.slice(2)}"`
        : shellEscape(fullPath)
      await execSSHCommand(ssh_host, `mkdir ${remotePath}`)
      return { path: fullPath }
    }

    const dirPath = expandPath(parentPath)
    const fullPath = path.join(dirPath, name)
    await fs.promises.mkdir(fullPath)
    const resultPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
    return { path: resultPath }
  })

export const sshFixMaxSessions = publicProcedure
  .input(sshHostInput)
  .mutation(async ({ input }) => {
    const validation = validateSSHHost(input.host)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
    try {
      const cmd = [
        "sudo sed -i '/^MaxSessions/Id' /etc/ssh/sshd_config",
        "echo 'MaxSessions 64' | sudo tee -a /etc/ssh/sshd_config",
        'sudo sshd -t',
        'sudo systemctl restart sshd 2>/dev/null || sudo systemctl restart ssh 2>/dev/null || sudo service sshd restart 2>/dev/null || sudo service ssh restart',
      ].join(' && ')
      await execSSHCommand(input.host, cmd, { timeout: 10000 })
      return { success: true as const }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fix MaxSessions'
      log.error(`Failed to fix MaxSessions for ${input.host}: ${message}`)
      throw new Error(message)
    }
  })
