import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { deployBranchesToKeep, OLD_DEPLOY_BRANCHES } from '../../server/settings.ts'

// The production branches no longer have a default: an install that used the module with the old one, never saved,
// keeps it (server/settings.ts). The module has served once any of its tables has a row: a day's draft, a day the
// user edited, an entry of the Time Log.
const KEY = 'lunar-industries-temps.deployBranches'
const TABLES = ['lunar_industries_temps_drafts', 'lunar_industries_temps_days', 'lunar_industries_temps_log']

export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.defer(async (db) => {
      const row: { value: string } | null = await db.from(this.tableName).where('key', KEY).select('value').first()
      let used = false
      for (const table of TABLES) used ||= Boolean(await db.from(table).select('day').first())
      const value = deployBranchesToKeep(row?.value, used)
      if (value === null) return
      // As Lucid writes a date in SQLite: a Date would be stored as milliseconds, which the core's Setting model cannot
      // read, and then no setting at all would load.
      const now = DateTime.local().toFormat('yyyy-MM-dd HH:mm:ss')
      await db.table(this.tableName).insert({ key: KEY, value, created_at: now, updated_at: now })
    })
  }

  // The value it kept goes, unless the user changed it since.
  async down() {
    this.defer(async (db) => {
      await db.from(this.tableName).where({ key: KEY, value: JSON.stringify(OLD_DEPLOY_BRANCHES) }).delete()
    })
  }
}
