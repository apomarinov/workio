import { z } from 'zod'

// --- Branch schemas ---

export const branchInfoSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  commitDate: z.string(),
})

export const branchesResponseSchema = z.object({
  local: z.array(branchInfoSchema),
  remote: z.array(branchInfoSchema),
})

// --- Diff schemas ---

export const fileStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'untracked',
])

export const changedFileSchema = z.object({
  path: z.string(),
  status: fileStatusSchema,
  added: z.number(),
  removed: z.number(),
  oldPath: z.string().optional(),
})

export const commitSchema = z.object({
  hash: z.string(),
  message: z.string(),
  author: z.string(),
  date: z.string(),
})

// --- Input schemas ---

export const terminalIdInput = z.object({
  terminalId: z.number(),
})

export const checkoutInput = terminalIdInput.extend({
  branch: z.string().min(1),
})

export const pullInput = terminalIdInput.extend({
  branch: z.string().min(1),
})

export const pushInput = terminalIdInput.extend({
  branch: z.string().min(1),
  force: z.boolean().optional(),
})

export const rebaseInput = terminalIdInput.extend({
  branch: z.string().min(1),
})

export const deleteBranchInput = terminalIdInput.extend({
  branch: z.string().min(1),
  deleteRemote: z.boolean().optional(),
})

export const renameBranchInput = terminalIdInput.extend({
  branch: z.string().min(1),
  newName: z.string().min(1),
  renameRemote: z.boolean().optional(),
})

export const createBranchInput = terminalIdInput.extend({
  name: z.string().min(1),
  from: z.string().min(1),
})

// Diff inputs

export const changedFilesInput = terminalIdInput.extend({
  base: z.string().optional(),
})

export const fileDiffInput = terminalIdInput.extend({
  path: z.string().optional(),
  context: z.string().optional(),
  base: z.string().optional(),
})

export const commitsInput = terminalIdInput.extend({
  head: z.string().min(1),
  base: z.string().min(1),
})

export const branchCommitsInput = terminalIdInput.extend({
  branch: z.string().min(1),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
})

export const branchConflictsInput = terminalIdInput.extend({
  head: z.string().min(1),
  base: z.string().min(1),
})

// --- Types ---

export type BranchInfo = z.infer<typeof branchInfoSchema>
export type BranchesResponse = z.infer<typeof branchesResponseSchema>
export type FileStatus = z.infer<typeof fileStatusSchema>
export type ChangedFile = z.infer<typeof changedFileSchema>
export type Commit = z.infer<typeof commitSchema>
