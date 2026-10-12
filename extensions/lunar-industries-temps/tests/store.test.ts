import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Database } from '@adonisjs/lucid/database'
import { Emitter } from '@adonisjs/core/events'
import { Logger } from '@adonisjs/core/logger'
import { AppFactory } from '@adonisjs/core/factories/app'
import { DbStore, type NewDraftRow } from '../server/store.ts'

// The store on a real SQLite database (in memory) through Lucid, which the fake store of the other tests cannot say
// anything about: what SQLite refuses only shows here.
let database: Database
let store: DbStore

beforeAll(async () => {
  const app = new AppFactory().create(new URL('file:///tmp/'), () => {})
  const emitter = new Emitter(app)
  database = new Database(
    {
      connection: 'main',
      connections: { main: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } },
    },
    new Logger({ enabled: false }),
    emitter
  )
  await database.connection().schema.createTable('lunar_industries_temps_drafts', (table) => {
    table.increments('id')
    table.string('day').notNullable()
    table.string('task_id').nullable()
    table.string('label').notNullable().defaultTo('')
    table.text('repo').nullable()
    table.string('branch').nullable()
    table.integer('share').notNullable().defaultTo(0)
    table.integer('tiny').notNullable().defaultTo(0)
    table.integer('confirmed').notNullable().defaultTo(0)
    table.text('reason').notNullable().defaultTo('')
    table.text('props').notNullable().defaultTo('{}')
  })
  await database.connection().schema.createTable('lunar_industries_temps_days', (table) => {
    table.string('day').primary()
    table.integer('edited').notNullable().defaultTo(0)
  })
  store = new DbStore(database)
})

afterAll(async () => {
  await database.manager.closeAll()
})

const lines = (count: number): NewDraftRow[] =>
  Array.from({ length: count }, (_, i) => ({ taskId: `t${i}`, label: 'Dev', share: 1, confirmed: false, branch: `feat/${i}` }))

describe('DbStore.writeDraft', () => {
  it('writes more lines than SQLite takes in one insert, all of them and in order', async () => {
    await store.writeDraft('2026-10-01', lines(1234), true)
    const rows = await store.drafts('2026-10-01')
    expect(rows).toHaveLength(1234)
    expect(rows.map((r) => r.taskId)).toEqual(lines(1234).map((r) => r.taskId))
    expect(await store.edited('2026-10-01')).toBe(true)
  })

  it('replaces the previous draft of the day and leaves the other days alone', async () => {
    await store.writeDraft('2026-10-02', lines(3))
    await store.writeDraft('2026-10-01', lines(2))
    expect(await store.drafts('2026-10-01')).toHaveLength(2)
    expect(await store.drafts('2026-10-02')).toHaveLength(3)
  })

  it('writes an empty draft', async () => {
    await store.writeDraft('2026-10-02', [])
    expect(await store.drafts('2026-10-02')).toEqual([])
  })
})
