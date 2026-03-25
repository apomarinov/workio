import { z } from 'zod'

// --- Branch types ---

export interface BranchInfo {
  name: string
  current: boolean
  commitDate: string
}

export interface BranchesResponse {
  local: BranchInfo[]
  remote: BranchInfo[]
}

// --- Diff types ---

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export interface ChangedFile {
  path: string
  status: FileStatus
  added: number
  removed: number
  oldPath?: string
}

export interface Commit {
  hash: string
  message: string
  author: string
  date: string
}

// --- Input schemas ---

export const terminalIdInput = z.object({
  terminalId: z.number(),
})

export const branchInput = terminalIdInput.extend({
  branch: z.string().min(1),
})

export const headBaseInput = terminalIdInput.extend({
  head: z.string().min(1),
  base: z.string().min(1),
})

// Branch mutation inputs

export const pushInput = branchInput.extend({
  force: z.boolean().optional(),
})

export const deleteBranchInput = branchInput.extend({
  deleteRemote: z.boolean().optional(),
})

export const renameBranchInput = branchInput.extend({
  newName: z.string().min(1),
  renameRemote: z.boolean().optional(),
})

export const createBranchInput = terminalIdInput.extend({
  name: z.string().min(1),
  from: z.string().min(1),
})

// Diff query inputs

export const changedFilesInput = terminalIdInput.extend({
  base: z.string().optional(),
})

export const fileDiffInput = terminalIdInput.extend({
  path: z.string().optional(),
  context: z.string().optional(),
  base: z.string().optional(),
})

export const branchCommitsInput = branchInput.extend({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
})

// Commit mutation inputs

export const commitInput = terminalIdInput.extend({
  message: z.string(),
  amend: z.boolean().optional(),
  noVerify: z.boolean().optional(),
  files: z.array(z.string()).optional(),
})

export const discardInput = terminalIdInput.extend({
  files: z.array(z.string()).min(1),
})

export const commitHashInput = terminalIdInput.extend({
  commitHash: z.string().min(1),
})
