import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'lunar_industries_plane_tasks'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // JSON: the people assigned to the work item, as the core takes them (TaskPerson); the next sync fills it.
      table.text('people').notNullable().defaultTo('[]')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('people')
    })
  }
}
