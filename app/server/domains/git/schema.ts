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

// --- Types ---

export type BranchInfo = z.infer<typeof branchInfoSchema>
export type BranchesResponse = z.infer<typeof branchesResponseSchema>
