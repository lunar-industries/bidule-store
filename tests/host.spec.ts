import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { ExtensionHost } from '#extensions/host'

// Our modules in the core's real host (bidule's `node ace test`), not in their unit tests' fake context: what the core
// refuses of an extension (a setting its manifest does not declare, a command or role it did not ask for) only shows
// here. Run it with `scripts/check-host.sh` (it needs the modules linked in bidule/extensions: `npm run store:link`).
const TOKEN = { 'x-bidule-token': 'dev' }
const MODULES = [
  'lunar-industries-branches',
  'lunar-industries-claude',
  'lunar-industries-containers',
  'lunar-industries-kanban',
  'lunar-industries-temps',
]

test.group('Lunar Industries modules · in the core’s host', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('each one is listed, without an error', async ({ client, assert }) => {
    const res = await client.get('/api/extensions').headers(TOKEN)
    res.assertStatus(200)
    const listed: { id: string; error: string | null }[] = res.body().extensions ?? res.body()
    for (const id of MODULES) {
      const ext = listed.find((e) => e.id === id)
      assert.exists(ext, `${id} is not listed (npm run store:link)`)
      assert.isNull(ext?.error, `${id}: ${ext?.error}`)
    }
  })

  test('the Kanban reads the point kanban, and Claude contributes its two card actions to it', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/extensions').headers(TOKEN)
    const listed: { id: string; points: { id: string }[]; to: Record<string, { actions?: unknown[] }> }[] =
      res.body()
    const kanban = listed.find((e) => e.id === 'lunar-industries-kanban')
    const claude = listed.find((e) => e.id === 'lunar-industries-claude')
    assert.deepInclude(kanban?.points ?? [], { id: 'kanban', title: 'Cartes du Kanban' })
    assert.lengthOf(claude?.to.kanban?.actions ?? [], 2)
  })

  test('the settings page has a section for each, with fields of its own namespace and valid defaults', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/settings').headers(TOKEN)
    res.assertStatus(200)
    const groups: { id: string; fields: { key: string; type: string; default?: unknown; options?: { value: string }[] }[] }[] =
      res.body().groups
    for (const id of MODULES) {
      const group = groups.find((g) => g.id === id)
      // A module without settings has no section.
      if (!group) continue
      for (const field of group.fields) {
        assert.isTrue(field.key.startsWith(`${id}.`), `${field.key} is outside ${id}`)
        if (field.type === 'choice') {
          assert.isTrue(
            field.options?.some((o) => o.value === field.default) ?? false,
            `${field.key}: its default is not one of its options`
          )
        }
      }
    }
  })

  test('each starts, and what it reads of its own settings is allowed by the core', async ({ assert }) => {
    const host = await app.container.make(ExtensionHost)
    for (const id of MODULES) {
      await host.activate(id)
      assert.isTrue(host.isStarted(id), `${id} did not start`)
    }
  })

  test('two objects merged in the core: the ids each one keeps go to the one left', async ({ assert }) => {
    const host = await app.container.make(ExtensionHost)
    const at = '2026-10-01T08:00:00Z'
    await db.table('lunar_industries_temps_drafts').insert({ day: '2026-10-01', task_id: 'old', label: 'Dév', share: 20 })
    await db.table('lunar_industries_temps_branch_tasks').insert({ repo: '/r', branch: 'feat/x', task_id: 'old' })
    await db.table('lunar_industries_temps_log').multiInsert([
      { id: 'e-old', day: '2026-10-01', task_id: 'old', share: 20 },
      { id: 'e-gone', day: '2026-10-02', task_id: 'old', share: 20 },
      { id: 'e-kept', day: '2026-10-02', task_id: 'kept', share: 20 },
    ])
    await db
      .table('lunar_industries_claude_sessions')
      .insert({ id: 's1', task_id: 'old', cwd: '/r', mode: 'default', status: 'saved', title: 'x', created_at: at, updated_at: at })

    // As the core says them after a put: the modules start on the event if they are not running.
    await host.emit('objects.merged', { type: 'task', from: 'old', into: 'kept' })
    await host.emit('objects.merged', { type: 'timeEntry', from: 'e-old', into: 'e-new' })
    await host.emit('objects.merged', { type: 'timeEntry', from: 'e-gone', into: 'e-kept' })

    const tasks = async (table: string) => (await db.from(table).select('task_id')).map((r: { task_id: string }) => r.task_id)
    assert.deepEqual(await tasks('lunar_industries_temps_drafts'), ['kept'])
    assert.deepEqual(await tasks('lunar_industries_temps_branch_tasks'), ['kept'])
    assert.deepEqual(await tasks('lunar_industries_claude_sessions'), ['kept'])
    const log: { id: string; task_id: string }[] = await db.from('lunar_industries_temps_log').orderBy('id')
    assert.deepEqual(
      log.map((l) => [l.id, l.task_id]),
      [
        ['e-kept', 'kept'],
        ['e-new', 'kept'],
      ]
    )
  })

  // The routes that read the module's settings (the day's, the board's branches, the list…): none may fail, which is
  // what an extension asking for a setting or a command the core refuses does (an error 500, or its message).
  for (const [id, path] of [
    ['lunar-industries-temps', 'days/2026-10-01'],
    ['lunar-industries-temps', 'summary'],
    ['lunar-industries-kanban', 'branches'],
    ['lunar-industries-branches', 'branches'],
    ['lunar-industries-containers', 'containers'],
    ['lunar-industries-claude', 'status'],
  ] as const) {
    test(`GET /api/ext/${id}/${path} answers without an error of the core`, async ({ client, assert }) => {
      const res = await client.get(`/api/ext/${id}/${path}`).headers(TOKEN)
      // 403: the experimental Claude sessions are off, by design. 409/502: a role without its provider or a tool
      // missing here. What must never be is a refusal of the core.
      assert.notInclude([500], res.status(), JSON.stringify(res.body()))
      assert.notMatch(JSON.stringify(res.body()), /non déclaré/)
    })
  }
})
