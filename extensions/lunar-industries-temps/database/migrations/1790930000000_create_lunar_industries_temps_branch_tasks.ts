import { BaseSchema } from '@adonisjs/lucid/schema'

// The task of each branch seen linked to one, kept after git forgets the branch (merged, then deleted): the commits it
// made keep their task, so a day computed later reads the same as the day it was lived.
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('lunar_industries_temps_branch_tasks', (table) => {
      table.text('repo').notNullable()
      table.string('branch').notNullable()
      table.string('task_id').notNullable()
      table.primary(['repo', 'branch'])
    })
  }

  async down() {
    this.schema.dropTable('lunar_industries_temps_branch_tasks')
  }
}
