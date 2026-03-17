import { publicProcedure } from '../../trpc/init'
import { getSettings } from './db'
import { DEFAULT_CONFIG } from './schema'

export const get = publicProcedure.query(async () => {
  const settings = await getSettings()
  const patches: Record<string, unknown> = {}

  // Backfill missing keymap entries
  if (settings.keymap) {
    const defaultKeys = Object.keys(
      DEFAULT_CONFIG.keymap,
    ) as (keyof typeof DEFAULT_CONFIG.keymap)[]
    const missingKeys = defaultKeys.filter((k) => !(k in settings.keymap!))
    if (missingKeys.length > 0) {
      const backfilled = { ...settings.keymap }
      for (const k of missingKeys) {
        backfilled[k] = DEFAULT_CONFIG.keymap[k]
      }
      patches.keymap = backfilled
    }
  }

  // Backfill missing status bar sections
  if (settings.statusBar) {
    const savedNames = new Set(settings.statusBar.sections.map((s) => s.name))
    const missing = DEFAULT_CONFIG.statusBar.sections.filter(
      (s) => !savedNames.has(s.name),
    )
    if (missing.length > 0) {
      patches.statusBar = {
        ...settings.statusBar,
        sections: [...settings.statusBar.sections, ...missing],
      }
    }
  }

  return Object.keys(patches).length > 0
    ? { ...settings, ...patches }
    : settings
})
