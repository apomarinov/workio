import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '../..')

// Load env from root project directory
dotenv.config({ path: path.join(rootDir, '.env') })
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true })

const envSchema = z.object({
  DB_NAME: z.string().default('data.db'),
  SERVER_PORT: z.coerce.number().default(5176),
  CLIENT_PORT: z.coerce.number().default(5175),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = {
  ...parsed.data,
  ROOT_DIR: rootDir,
  DB_PATH: path.join(rootDir, parsed.data.DB_NAME),
}

console.log(`[env] DB_PATH: ${env.DB_PATH}`)
console.log(`[env] SERVER_PORT: ${env.SERVER_PORT}`)
