import { BaseSchema } from '@adonisjs/lucid/schema'

// The tasks were named by their id in the tool (a Notion page) and the Time Log's entries by their page: now by the
// core's own ids, once its providers made them objects (after Notion's migrations, by their time). A task the core
// does not know leaves its draft line without a task, and its branch forgotten; an entry it does not know leaves the
// mirror, read again from the Time Log at the next look.
const TASK = (table: string) =>
  `(SELECT object_id FROM core_sources WHERE object_type = 'task' AND remote_id = ${table}.task_id ORDER BY owner DESC LIMIT 1)`

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const drafts = 'lunar_industries_temps_drafts'
      await db.rawQuery(`UPDATE ${drafts} SET task_id = ${TASK(drafts)} WHERE task_id IS NOT NULL`)

      const branches = 'lunar_industries_temps_branch_tasks'
      await db.rawQuery(`UPDATE ${branches} SET task_id = COALESCE(${TASK(branches)}, '')`)
      await db.from(branches).where('task_id', '').delete()

      const log = 'lunar_industries_temps_log'
      await db.rawQuery(
        `UPDATE ${log} SET id = COALESCE((SELECT object_id FROM core_sources WHERE object_type = 'timeEntry' AND remote_id = ${log}.id ORDER BY owner DESC LIMIT 1), 'gone:' || id)`
      )
      await db.from(log).whereLike('id', 'gone:%').delete()
      await db.rawQuery(`UPDATE ${log} SET task_id = ${TASK(log)} WHERE task_id IS NOT NULL`)
    })
  }

  // The tools' ids are not kept: going back leaves the drafts without their task, and forgets the rest (read again).
  async down() {
    this.defer(async (db) => {
      await db.from('lunar_industries_temps_drafts').update({ task_id: null })
      await db.from('lunar_industries_temps_branch_tasks').delete()
      await db.from('lunar_industries_temps_log').delete()
    })
  }
}
