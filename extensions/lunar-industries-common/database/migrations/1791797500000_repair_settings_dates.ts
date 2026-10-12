import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'

// The settings that the modules' migrations wrote before 0.1.2 (common), 0.5.4 (kanban) and 0.4.4 (temps) have their
// dates in milliseconds, which the core's Setting model cannot read: no setting at all would load (Réglages stays
// empty, the mascot goes back to the default one). They get the date as Lucid writes it in SQLite.
const COLUMNS = ['created_at', 'updated_at']

export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.defer(async (db) => {
      for (const column of COLUMNS) {
        const rows: { key: string; at: number }[] = await db
          .from(this.tableName)
          .whereLike('key', 'lunar-industries-%')
          .whereRaw(`typeof(${column}) in ('integer', 'real')`)
          .select('key', `${column} as at`)
        for (const { key, at } of rows) {
          const value = DateTime.fromMillis(at).toFormat('yyyy-MM-dd HH:mm:ss')
          await db.from(this.tableName).where('key', key).update({ [column]: value })
        }
      }
    })
  }

  // Nothing to undo: the dates read the same.
  async down() {}
}
