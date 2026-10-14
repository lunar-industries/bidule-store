import { BaseSchema } from '@adonisjs/lucid/schema'

// The delay before a task is to be chased up is no longer a setting of this module (0.7.0): the board never asks for
// one. Its saved value goes, the one 1791778468854_stale_days_from_kanban.ts copied from the official Kanban included.
const KEY = 'lunar-industries-kanban.staleDays'

export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.defer(async (db) => {
      await db.from(this.tableName).where('key', KEY).delete()
    })
  }

  // The value is gone: the setting, back with an older version, reads its default.
  async down() {}
}
