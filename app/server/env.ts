import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'
import { log } from './logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '../..')

// Load env from root project directory
dotenv.config({ path: path.join(rootDir, '.env') })
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true })

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://localhost/claude_dashboard'),
  SERVER_PORT: z.coerce.number().default(5176),
  CLIENT_PORT: z.coerce.number().default(5175),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  log.error('Invalid environment variables:')
  log.error(JSON.stringify(parsed.error.flatten().fieldErrors))
  process.exit(1)
}

export const env = {
  ...parsed.data,
  ROOT_DIR: rootDir,
}

log.info(
  `[env] DATABASE_URL: ${env.DATABASE_URL.replace(/\/\/.*@/, '//*****@')}`,
)
log.info(`[env] SERVER_PORT: ${env.SERVER_PORT}`)
