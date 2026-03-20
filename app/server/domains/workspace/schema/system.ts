import { z } from 'zod'

export const PAGE_SIZE = 100

// --- Directory listing ---

export const dirEntrySchema = z.object({
  name: z.string(),
  isDir: z.boolean(),
})

export const dirResultSchema = z.object({
  entries: z.array(dirEntrySchema).optional(),
  hasMore: z.boolean().optional(),
  error: z.string().nullable().optional(),
})

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

export const sshHostSchema = z.object({
  alias: z.string(),
  hostname: z.string(),
  user: z.string().nullable(),
})

export const sshHostInput = z.object({
  host: z.string(),
})

// --- Types ---

export type DirEntry = z.infer<typeof dirEntrySchema>
export type DirResult = z.infer<typeof dirResultSchema>
export type SSHHost = z.infer<typeof sshHostSchema>
