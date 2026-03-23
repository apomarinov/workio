import type { FastifyInstance } from 'fastify'
import { getActivePermissions } from '../db'

export default async function sessionRoutes(fastify: FastifyInstance) {
  // Get active permissions across all sessions
  fastify.get('/api/permissions/active', async () => {
    return await getActivePermissions()
  })
}
