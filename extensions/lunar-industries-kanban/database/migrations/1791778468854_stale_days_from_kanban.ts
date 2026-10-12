import { BaseSchema } from '@adonisjs/lucid/schema'
import { staleDaysToKeep } from '../../server/stale_days.ts'

// The official Kanban's delay before a task is to be chased up, if the user set one, becomes this module's
// (server/stale_days.ts).
const FROM = 'kanban.staleDays'
const TO = 'lunar-industries-kanban.staleDays'

export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.defer(async (db) => {
      const rows: { key: string; value: string }[] = await db
        .from(this.tableName)
        .whereIn('key', [FROM, TO])
        .select('key', 'value')
      const stored = (key: string) => rows.find((row) => row.key === key)?.value
      const value = staleDaysToKeep(stored(FROM), stored(TO))
      if (value === null) return
      const now = new Date()
      await db.table(this.tableName).insert({ key: TO, value, created_at: now, updated_at: now })
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.from(this.tableName).where('key', TO).delete()
    })
  }
}
