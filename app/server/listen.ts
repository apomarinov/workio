import pg from 'pg'
import type { Server as SocketIOServer } from 'socket.io'
import { getMessagesByIds } from './db'
import { log } from './logger'

let listenerClient: pg.Client | null = null

export async function initPgListener(
  io: SocketIOServer,
  connectionString: string,
) {
  listenerClient = new pg.Client({ connectionString })
  await listenerClient.connect()

  await listenerClient.query('LISTEN hook')
  await listenerClient.query('LISTEN session_update')

  listenerClient.on('notification', async (msg) => {
    if (!msg.payload) return

    try {
      const payload = JSON.parse(msg.payload)

      if (msg.channel === 'hook') {
        io.emit('hook', payload)
        log.info(`LISTEN: hook event session=${payload.session_id}`)
      }

      if (msg.channel === 'session_update') {
        const messages = await getMessagesByIds(payload.message_ids)
        io.emit('session_update', {
          session_id: payload.session_id,
          messages,
        })
        log.info(
          `LISTEN: session_update session=${payload.session_id} messages=${messages.length}`,
        )
      }
    } catch (err) {
      log.error(
        { err, channel: msg.channel },
        'LISTEN: error processing notification',
      )
    }
  })

  listenerClient.on('error', (err) => {
    log.error({ err }, 'LISTEN: connection error, reconnecting...')
    listenerClient = null
    setTimeout(() => initPgListener(io, connectionString), 1000)
  })

  log.info(
    'LISTEN: connected to PostgreSQL, listening on [hook, session_update]',
  )
}
