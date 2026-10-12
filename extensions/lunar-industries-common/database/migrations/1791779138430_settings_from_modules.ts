import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { settingsToKeep } from '../../server/settings_to_keep.ts'

// The settings the modules each kept, now shared: what the user saved in them is taken over once
// (server/settings_to_keep.ts).
//
// The modules served before when one of their settings was saved, or one of their tables has a row. The settings that
// the modules' own migrations write on a new install (the Kanban's delay taken from the official one) do not count,
// nor this module's own.
const WRITTEN_AT_INSTALL = ['lunar-industries-kanban.staleDays']
const TABLES = [
  'lunar_industries_temps_drafts',
  'lunar_industries_temps_days',
  'lunar_industries_temps_log',
  'lunar_industries_claude_sessions',
]

export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.defer(async (db) => {
      const rows: { key: string; value: string }[] = await db
        .from(this.tableName)
        .whereLike('key', 'lunar-industries-%')
        .select('key', 'value')
      const stored = new Map(rows.map((r) => [r.key, r.value]))
      let used = rows.some((r) => !r.key.startsWith('lunar-industries-common.') && !WRITTEN_AT_INSTALL.includes(r.key))
      for (const table of TABLES) {
        if (!used && (await db.schema.hasTable(table))) used = Boolean(await db.from(table).first())
      }
      const kept = settingsToKeep(stored, used)
      if (!kept.size) return
      // As Lucid writes a date in SQLite: a Date would be stored as milliseconds, which the core's Setting model cannot
      // read, and then no setting at all would load.
      const now = DateTime.local().toFormat('yyyy-MM-dd HH:mm:ss')
      await db
        .table(this.tableName)
        .multiInsert([...kept].map(([key, value]) => ({ key, value, created_at: now, updated_at: now })))
    })
  }

  // Back to the modules' own settings, which were left as they were.
  async down() {
    this.defer(async (db) => {
      await db.from(this.tableName).whereLike('key', 'lunar-industries-common.%').delete()
    })
  }
}
