import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { env } from './env'
import serverEvents from './lib/events'
import { log } from './logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.join(__dirname, '../../schema.sql')

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
})

// Initialize database from schema.sql
export async function initDb() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    log.error(`[db] Schema file not found: ${SCHEMA_PATH}`)
    process.exit(1)
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')

  try {
    await pool.query(schema)
  } catch (err: unknown) {
    // In dev mode, auto-create the database if it doesn't exist (code 3D000)
    if (
      env.NODE_ENV === 'development' &&
      err instanceof Error &&
      (err as { code?: string }).code === '3D000'
    ) {
      const dbUrl = new URL(env.DATABASE_URL)
      const dbName = dbUrl.pathname.slice(1)
      log.info(`[db] Database "${dbName}" does not exist, creating...`)

      dbUrl.pathname = '/postgres'
      const adminClient = new pg.Client({ connectionString: dbUrl.toString() })
      try {
        await adminClient.connect()
        await adminClient.query(
          `CREATE DATABASE "${dbName.replace(/"/g, '""')}"`,
        )
        log.info(`[db] Created database "${dbName}"`)
      } finally {
        await adminClient.end()
      }

      await pool.query(schema)
    } else {
      throw err
    }
  }

  log.info('[db] Database initialized from schema.sql')

  serverEvents.emit('db:initialized')

  // Cleanup general logs older than 1 week
  const logsResult = await pool.query(`
    DELETE FROM logs WHERE created_at < NOW() - INTERVAL '1 week'
  `)
  if (logsResult.rowCount && logsResult.rowCount > 0) {
    log.info(`[db] Cleaned up ${logsResult.rowCount} logs`)
  }
}

export default pool
