import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { ExtensionHost } from '#extensions/host'

// Our modules in the core's real host (bidule's `node ace test`), not in their unit tests' fake context: what the core
// refuses of an extension (a setting its manifest does not declare, a command or role it did not ask for) only shows
// here. Run it with `scripts/check-host.sh` (it needs the modules in bidule/extensions: `npm run store:link`, or the
// copies the publication workflow makes). The modules are those the core lists as community ones: none is named here
// but the module of time, whose conflict with the official Temps is checked.
//
// The script runs it twice. First as the checkout is, with the official Temps on: `lunar-industries-temps` declares
// that it cannot run beside it, so the core puts it in error and it must say so. Then with Temps left out
// (LUNAR_WITHOUT_TEMPS=1, a folder of extensions without it): the module starts and does its work.
const TOKEN = { 'x-bidule-token': 'dev' }
const WITHOUT_TEMPS = process.env.LUNAR_WITHOUT_TEMPS === '1'
const TEMPS = 'lunar-industries-temps'
// Whether a module runs in this pass: the one in conflict with the official Temps does not run beside it.
const runs = (id: string) => WITHOUT_TEMPS || id !== TEMPS

type Listed = { id: string; error: string | null; unofficial: boolean }
type Group = {
  id: string
  fields: { key: string; type: string; default?: unknown; options?: { value: string }[] }[]
}

test.group('Lunar Industries modules · in the core’s host', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // This store's modules, as the core lists them: those its package marks `bidule.storeOnly`.
  const storeModules = async (client: ApiClient) => {
    const res = await client.get('/api/extensions').headers(TOKEN)
    res.assertStatus(200)
    const listed: Listed[] = res.body()
    return listed.filter((e) => e.unofficial)
  }

  test('each one is listed, without an error', async ({ client, assert }) => {
    const modules = await storeModules(client)
    assert.isNotEmpty(modules, 'no module of this store is listed (npm run store:link)')
    for (const ext of modules.filter(({ id }) => runs(id))) assert.isNull(ext.error, `${ext.id}: ${ext.error}`)
  })

  test('the module of time is in error beside the official Temps, and runs without it', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/extensions').headers(TOKEN)
    const listed: { id: string; error: string | null; active: boolean }[] = res.body()
    const official = listed.find((e) => e.id === 'temps')
    const ours = listed.find((e) => e.id === TEMPS)
    assert.exists(ours, `${TEMPS} is not listed (npm run store:link)`)
    if (WITHOUT_TEMPS) {
      assert.notExists(official, 'the official Temps should be left out of this pass')
      assert.isTrue(ours?.active)
      return
    }
    assert.isTrue(official?.active, 'the official Temps should be on in this pass')
    assert.isNull(official?.error)
    assert.match(ours?.error ?? '', /ne peut pas tourner avec Temps : désactivez l'une des deux/)
    assert.isFalse(ours?.active)
  })

  test('the terminal module holds the role terminal, with the official Terminal left out of this run', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/extensions').headers(TOKEN)
    const listed: { id: string; holds: string[] }[] = res.body()
    assert.notExists(
      listed.find((e) => e.id === 'terminal'),
      'the official Terminal should be left out (scripts/check-host.sh)'
    )
    assert.deepEqual(listed.find((e) => e.id === 'lunar-industries-terminal')?.holds, ['terminal'])
  })

  test('the Kanban reads the point kanban', async ({ client, assert }) => {
    const res = await client.get('/api/extensions').headers(TOKEN)
    const listed: { id: string; points: { id: string }[] }[] = res.body()
    const kanban = listed.find((e) => e.id === 'lunar-industries-kanban')
    assert.deepInclude(kanban?.points ?? [], { id: 'kanban', title: 'Cartes du Kanban' })
  })

  test('the settings page has a section for each, with fields of its own namespace and valid defaults', async ({
    client,
    assert,
  }) => {
    const ids = (await storeModules(client)).map((e) => e.id)
    const res = await client.get('/api/settings').headers(TOKEN)
    res.assertStatus(200)
    const groups: Group[] = res.body().groups
    for (const id of ids) {
      // A module without settings has no section.
      for (const field of groups.find((g) => g.id === id)?.fields ?? []) {
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

  test('a setting dated in milliseconds by an older migration is repaired, and the settings load again', async ({
    client,
    assert,
  }) => {
    const key = 'lunar-industries-kanban.trayOpen'
    await db.from('settings').where('key', key).delete()
    await db.table('settings').insert({ key, value: '"false"', created_at: Date.now(), updated_at: Date.now() })
    const file = app.makePath('../../extensions/lunar-industries-common/database/migrations/1791797500000_repair_settings_dates.ts')
    const { default: Repair } = await import(file)
    await new Repair(db.connection(), file).execUp()
    const row = await db.from('settings').where('key', key).select('created_at', 'updated_at').firstOrFail()
    assert.match(row.created_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    assert.match(row.updated_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    ;(await client.get('/api/settings').headers(TOKEN)).assertStatus(200)
  })

  test('each starts, and what it reads of its own settings is allowed by the core', async ({ client, assert }) => {
    const host = await app.container.make(ExtensionHost)
    for (const { id } of (await storeModules(client)).filter((e) => runs(e.id))) {
      await host.activate(id)
      assert.isTrue(host.isStarted(id), `${id} did not start`)
    }
  })

  test('lunar-industries-common’s commands from the interface: a known repo’s target saved and read back, the rest refused', async ({
    client,
    assert,
  }) => {
    const host = await app.container.make(ExtensionHost)
    // A repo of git's, as git puts it in the core.
    await host.objects.put(
      'git',
      'repository',
      [{ remoteId: '/r/app', fields: { path: '/r/app', label: 'app', remoteHost: null, remotePath: null, defaultBranch: 'main' } }],
      { account: '' }
    )
    const run = (id: string, args: unknown) => client.post(`/api/commands/${id}`).headers(TOKEN).json({ args })
    ;(await run('lunar-industries-common.setTarget', { repo: '/r/app', target: 'develop' })).assertStatus(200)
    const read = await run('lunar-industries-common.settings', null)
    read.assertStatus(200)
    assert.deepEqual(read.body().result.targets, { '/r/app': 'develop' })
    const unknown = await run('lunar-industries-common.setTarget', { repo: '/elsewhere', target: 'main' })
    assert.equal(unknown.status(), 404)
    assert.equal(unknown.body().error, 'Dépôt inconnu')
    assert.equal((await run('lunar-industries-common.link', { repo: '' })).status(), 422)
    // Back as it was: the settings the core keeps in memory outlive the test's transaction.
    ;(await run('lunar-industries-common.setTarget', { repo: '/r/app', target: null })).assertStatus(200)
  })

  test('two objects merged in the core: the ids each one keeps go to the one left', async ({ assert }) => {
    // Its tables are those of the module of time, which does not run (nor migrate) beside the official Temps.
    if (!WITHOUT_TEMPS) return
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

  test('the containers module reads the engines through docker’s actions, which the core lets it ask', async ({
    client,
    assert,
  }) => {
    const list = await client.get('/api/ext/lunar-industries-containers/containers').headers(TOKEN)
    list.assertStatus(200)
    assert.isArray(list.body().containers)
    // A container that cannot exist is refused by docker's own validation, not by the core.
    const unknown = await client
      .post('/api/ext/lunar-industries-containers/engines/docker/containers/--all/action')
      .headers(TOKEN)
      .json({ action: 'stop' })
    assert.equal(unknown.status(), 422, JSON.stringify(unknown.body()))
    assert.notMatch(JSON.stringify(unknown.body()), /non déclaré|n'est pas déclarée|demande l'extension/)
  })

  // The routes that read the module's settings (the day's, the board's branches, the list…): none may fail, which is
  // what an extension asking for a setting or a command the core refuses does (an error 500, or its message).
  const routes = [
    ['lunar-industries-temps', 'days/2026-10-01'],
    ['lunar-industries-temps', 'summary'],
    ['lunar-industries-kanban', 'branches'],
    ['lunar-industries-containers', 'containers'],
  ] as const
  for (const [id, path] of routes.filter(([id]) => runs(id))) {
    test(`GET /api/ext/${id}/${path} answers without an error of the core`, async ({ client, assert }) => {
      const res = await client.get(`/api/ext/${id}/${path}`).headers(TOKEN)
      // 409/502: a role without its provider or a tool
      // missing here. What must never be is a refusal of the core.
      assert.notInclude([500], res.status(), JSON.stringify(res.body()))
      assert.notMatch(JSON.stringify(res.body()), /non déclaré/)
    })
  }
})
