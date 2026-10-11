import { BaseSchema } from '@adonisjs/lucid/schema'

// A session's task was its id in the tool (a Notion page): now the core's own id. A session whose task the core does
// not know keeps going without one.
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(
        `UPDATE lunar_industries_claude_sessions SET task_id = (SELECT object_id FROM core_sources WHERE object_type = 'task' AND remote_id = lunar_industries_claude_sessions.task_id ORDER BY owner DESC LIMIT 1) WHERE task_id IS NOT NULL`
      )
    })
  }

  // The tool's ids are not kept: going back takes their task off the sessions.
  async down() {
    this.defer(async (db) => {
      await db.from('lunar_industries_claude_sessions').update({ task_id: null })
    })
  }
}
