import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { staleDaysToKeep } from '../../server/stale_days.ts'

// The official Kanban's delay before a task is to be chased up, if the user set one, becomes this module's
// (server/stale_days.ts).
const FROM = 'kanban.staleDays'
const TO = 'lunar-industries-kanban.staleDays'

export default class extends BaseSchema {
  protected tableName = 'settings'

  // Both settings as saved (JSON), undefined when not saved.
  async #stored(db: QueryClientContract) {
    const rows: { key: string; value: string }[] = await db
      .from(this.tableName)
      .whereIn('key', [FROM, TO])
      .select('key', 'value')
    const of = (key: string) => rows.find((row) => row.key === key)?.value
    return { official: of(FROM), own: of(TO) }
  }

  async up() {
    this.defer(async (db) => {
      const { official, own } = await this.#stored(db)
      const value = staleDaysToKeep(official, own)
      if (value === null) return
      // As Lucid writes a date in SQLite: a Date would be stored as milliseconds, which the core's Setting model cannot
      // read, and then no setting at all would load.
      const now = DateTime.local().toFormat('yyyy-MM-dd HH:mm:ss')
      await db.table(this.tableName).insert({ key: TO, value, created_at: now, updated_at: now })
    })
  }

  // The value copied goes, unless the user changed it since (it is no longer the official one's).
  async down() {
    this.defer(async (db) => {
      const { official, own } = await this.#stored(db)
      if (own !== undefined && own === official) await db.from(this.tableName).where('key', TO).delete()
    })
  }
}
