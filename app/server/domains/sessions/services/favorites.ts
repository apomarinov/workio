import { getSettings, updateSettings } from '@domains/settings/db'
import { deleteSessions, getAllSessions, getOldSessionIds } from '../db'

export async function listSessionsWithFavorites() {
  const [sessions, settings] = await Promise.all([
    getAllSessions(),
    getSettings(),
  ])
  const favorites = settings.favorite_sessions ?? []
  const favoriteSet = new Set(favorites)

  // Cleanup stale favorites
  const sessionIds = new Set(sessions.map((s) => s.session_id))
  const cleaned = favorites.filter((id) => sessionIds.has(id))
  if (cleaned.length !== favorites.length) {
    updateSettings({ favorite_sessions: cleaned })
  }

  return sessions.map((s) => ({
    ...s,
    is_favorite: favoriteSet.has(s.session_id),
  }))
}

export async function toggleFavorite(sessionId: string) {
  const settings = await getSettings()
  const favorites = settings.favorite_sessions ?? []
  const index = favorites.indexOf(sessionId)
  const isFavorite = index === -1
  const updated = isFavorite
    ? [...favorites, sessionId]
    : favorites.filter((fid) => fid !== sessionId)
  await updateSettings({ favorite_sessions: updated })
  return { is_favorite: isFavorite }
}

export async function cleanupOldSessions(weeks: number) {
  const settings = await getSettings()
  const favoriteIds = settings.favorite_sessions ?? []
  const oldIds = await getOldSessionIds(weeks, favoriteIds)
  if (oldIds.length === 0) {
    return { deleted: 0 }
  }
  const deleted = await deleteSessions(oldIds)
  return { deleted }
}
