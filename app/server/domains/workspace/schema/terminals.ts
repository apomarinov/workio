import { z } from 'zod'
import { shellSchema } from './shells'

// --- Sub-schemas (JSONB columns) ---

export const gitRepoStatusSchema = z.object({
  repo: z.string(),
  status: z.enum(['setup', 'done', 'failed']),
  workspaces_root: z.string().optional(),
  error: z.string().optional(),
})

export const setupStatusSchema = z.object({
  conductor: z.boolean().optional(),
  setup: z.string().optional(),
  delete: z.string().optional(),
  status: z.enum(['setup', 'delete', 'done', 'failed']),
  error: z.string().optional(),
})

export const portMappingSchema = z.object({
  port: z.number(),
  localPort: z.number(),
})

export const terminalSettingsSchema = z.object({
  defaultClaudeCommand: z.string().optional(),
  portMappings: z.array(portMappingSchema).optional(),
})

// --- Row schemas ---

export const terminalSchema = z.object({
  id: z.number(),
  cwd: z.string(),
  name: z.string().nullable(),
  shell: z.string().nullable(),
  ssh_host: z.string().nullable(),
  pid: z.number().nullable(),
  status: z.enum(['running', 'stopped']),
  git_branch: z.string().nullable(),
  git_repo: gitRepoStatusSchema.nullable(),
  setup: setupStatusSchema.nullable(),
  settings: terminalSettingsSchema.nullable(),
  shells: z.array(shellSchema).default([]),
  orphaned: z.boolean().default(false),
  created_at: z.string(),
  updated_at: z.string(),
})

export const projectSchema = z.object({
  id: z.number(),
  host: z.string(),
  path: z.string(),
})

// --- Input schemas ---

export const createTerminalInput = terminalSchema
  .pick({ cwd: true, ssh_host: true })
  .partial()
  .extend({
    name: z.string().optional(),
    shell: z.string().optional(),
    git_repo: z.string().optional(),
    workspaces_root: z.string().optional(),
    setup_script: z.string().optional(),
    delete_script: z.string().optional(),
    source_terminal_id: z.number().optional(),
  })

export const updateTerminalInput = terminalSchema.pick({ id: true }).extend({
  name: z.string().optional(),
  settings: terminalSettingsSchema.nullable().optional(),
})

export const deleteTerminalInput = terminalSchema
  .pick({ id: true })
  .extend({ deleteDirectory: z.boolean().optional() })

// --- Types ---

export type GitRepoStatus = z.infer<typeof gitRepoStatusSchema>
export type SetupStatus = z.infer<typeof setupStatusSchema>
export type PortMapping = z.infer<typeof portMappingSchema>
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>
export type Terminal = z.infer<typeof terminalSchema>
export type Project = z.infer<typeof projectSchema>
export type CreateTerminalInput = z.infer<typeof createTerminalInput>
export type UpdateTerminalInput = z.infer<typeof updateTerminalInput>
export type DeleteTerminalInput = z.infer<typeof deleteTerminalInput>
