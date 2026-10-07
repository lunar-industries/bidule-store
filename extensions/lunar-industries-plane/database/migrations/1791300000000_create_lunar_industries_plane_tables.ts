import { BaseSchema } from '@adonisjs/lucid/schema'

// The mirror of the user's Plane work items: the board's columns (the projects' states, one per name and group), the
// work items, and what the user did to them as each sync saw it (Plane keeps no history an API key can read).
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('lunar_industries_plane_columns', (table) => {
      table.string('name').notNullable()
      table.string('grp').notNullable()
      table.string('color').notNullable()
      table.integer('position').notNullable()
      table.primary(['name', 'grp'])
    })
    this.schema.createTable('lunar_industries_plane_tasks', (table) => {
      table.string('id').primary()
      // The id of the work item's project: its states are those of that project.
      table.string('project_id').notNullable()
      table.text('title').notNullable()
      table.string('status').notNullable()
      table.string('ref').nullable()
      table.text('url').nullable()
      table.string('last_edited').nullable()
      table.string('due').nullable()
      // JSON: the Notion page ids the description names, the migrated task this one may be the copy of.
      table.text('notion_ids').notNullable().defaultTo('[]')
      // Gone from the user's work items (handed over, deleted, a project no longer read): hidden, not lost.
      table.string('deleted_at').nullable()
    })
    this.schema.createTable('lunar_industries_plane_status_changes', (table) => {
      table.string('at').notNullable()
      table.string('task_id').notNullable()
      table.string('from').notNullable()
      table.string('to').notNullable()
      table.primary(['at', 'task_id'])
    })
    this.schema.createTable('lunar_industries_plane_edits', (table) => {
      table.string('at').notNullable()
      table.string('task_id').notNullable()
      table.text('detail').notNullable()
      table.primary(['at', 'task_id'])
    })
  }

  async down() {
    for (const table of [
      'lunar_industries_plane_edits',
      'lunar_industries_plane_status_changes',
      'lunar_industries_plane_tasks',
      'lunar_industries_plane_columns',
    ]) {
      this.schema.dropTable(table)
    }
  }
}
