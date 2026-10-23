import { BaseSchema } from '@adonisjs/lucid/schema'

const TABLE = 'lunar_industries_temps_branch_tasks'
const NEXT = `${TABLE}_next`

// A branch can serve several tasks: a remembered branch is now one row per task. SQLite does not change a primary key
// in place, so the table is made again, its rows kept.
export default class extends BaseSchema {
  async up() {
    this.schema.createTable(NEXT, (table) => {
      table.text('repo').notNullable()
      table.string('branch').notNullable()
      table.string('task_id').notNullable()
      table.primary(['repo', 'branch', 'task_id'])
    })
    this.defer(async (db) => {
      await db.rawQuery(`INSERT INTO ${NEXT} (repo, branch, task_id) SELECT repo, branch, task_id FROM ${TABLE}`)
    })
    this.schema.dropTable(TABLE)
    this.schema.renameTable(NEXT, TABLE)
  }

  // Back to one task per branch: the first one of each is kept.
  async down() {
    this.schema.createTable(NEXT, (table) => {
      table.text('repo').notNullable()
      table.string('branch').notNullable()
      table.string('task_id').notNullable()
      table.primary(['repo', 'branch'])
    })
    this.defer(async (db) => {
      await db.rawQuery(
        `INSERT INTO ${NEXT} (repo, branch, task_id) SELECT repo, branch, MIN(task_id) FROM ${TABLE} GROUP BY repo, branch`
      )
    })
    this.schema.dropTable(TABLE)
    this.schema.renameTable(NEXT, TABLE)
  }
}
