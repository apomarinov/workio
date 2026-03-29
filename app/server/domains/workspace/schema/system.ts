import { z } from 'zod'

export const PAGE_SIZE = 100

// --- Directory listing types ---

export type DirEntry = {
  name: string
  isDir: boolean
  isGit?: boolean
}

export type DirResult = {
  entries?: DirEntry[]
  hasMore?: boolean
  error?: string | null
}

export const listDirectoriesInput = z.object({
  paths: z.array(z.string()),
  page: z.number().default(0),
  hidden: z.boolean().default(false),
  ssh_host: z.string().optional(),
})

// --- Create directory ---

export const createDirectoryInput = z.object({
  path: z.string(),
  name: z.string(),
  ssh_host: z.string().optional(),
})

// --- Open in IDE ---

export const openInIdeInput = z.object({
  path: z.string(),
  ide: z.enum(['cursor', 'vscode']),
  terminal_id: z.number().optional(),
  ssh_host: z.string().optional(),
})

// --- Open in explorer ---

export const openInExplorerInput = z.object({
  path: z.string(),
  terminal_id: z.number().optional(),
})

// --- SSH ---

export type SSHHost = {
  alias: string
  hostname: string
  user: string | null
}

export const sshHostInput = z.object({
  host: z.string(),
})
