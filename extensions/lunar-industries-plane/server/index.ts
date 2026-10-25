import type { PutItem, ServerContext } from '@bidule/api/extensions'
import { meaningOf } from '@bidule/sdk/objects'
import '../contract.ts'
import { DbMirror } from './mirror.ts'
import { PlaneTasks } from './source.ts'
import { listOf, paletteOf } from './states.ts'

// Every 10 minutes: Plane changes without telling.
const SYNC_EVERY = 10 * 60_000

// Started with the app (`onStartup`): it keeps the mirror of the user's work items up to date, and the core's tasks
// with it.
export async function activate(ctx: ServerContext) {
  const setting = async (name: string) => String((await ctx.settings.get(`${ctx.id}.${name}`)) ?? '')
  const config = async () => ({
    url: await setting('url'),
    workspace: await setting('workspace'),
    projects: listOf(await setting('projects')),
    key: await ctx.secrets.get(`${ctx.id}.token`),
  })
  const mirror = new DbMirror(ctx.db)
  const source = new PlaneTasks(config, mirror)
  // The workspace is the account: two of them never mix.
  const account = async () => (await config()).workspace.trim() || 'default'

  /**
   * The mirror as the core's objects: the columns, the work items (one whose description names a Notion task the
   * core knows is that task's copy: one card, the Notion task's), the user's edits and changes of state as activity.
   */
  const publish = async () => {
    const where = await account()
    const columns = await mirror.columns()
    await ctx.objects.setColumns(
      columns.map((c) => ({ name: c.name, group: c.group, color: paletteOf(c.color), meaning: meaningOf(c.name) })),
      where
    )
    const groups = new Map(columns.map((c) => [c.name, c.group]))
    const items: PutItem<'task'>[] = []
    for (const task of await mirror.tasks()) {
      let copyOf: PutItem<'task'>['copyOf']
      for (const notionId of task.notionIds) {
        const original = await ctx.objects.find('task', { remoteId: notionId, provider: 'notion' })
        const at = original ? await ctx.objects.source('task', original.id) : null
        if (at) copyOf = { provider: at.provider, account: at.account, remoteId: at.remoteId }
        if (copyOf) break
      }
      items.push({
        remoteId: task.id,
        ref: task.ref,
        url: task.url,
        fields: {
          title: task.title,
          status: task.status,
          group: groups.get(task.status) ?? 'todo',
          role: 'owner',
          due: task.due,
          lastEdited: task.lastEdited,
          people: task.people,
        },
        ...(copyOf ? { copyOf } : {}),
      })
    }
    const ids = await ctx.objects.put('task', items, { account: where, complete: true })
    const known = await ctx.objects.idsOf('activity', where)
    const ever = ['0000', '9999'] as const
    const [edits, moves] = await Promise.all([mirror.edits(...ever), mirror.statusChanges(...ever)])
    const activity: PutItem<'activity'>[] = [
      ...edits.map((e) => ({
        remoteId: `edit ${e.at} ${e.taskId}`,
        taskId: e.taskId,
        fields: { at: e.at, kind: 'edit' as const, detail: e.detail, author: null },
      })),
      ...moves.map((m) => ({
        remoteId: `status ${m.at} ${m.taskId}`,
        taskId: m.taskId,
        fields: { at: m.at, kind: 'status' as const, detail: m.to, author: null },
        data: { from: m.from },
      })),
    ].flatMap(({ taskId, ...a }) => {
      const task = ids.get(taskId)
      if (!task || known.has(a.remoteId)) return []
      return [{ ...a, links: [{ kind: 'task', to: { type: 'task' as const, id: task } }] }]
    })
    await ctx.objects.put('activity', activity, { account: where })
  }

  const sync = async () => {
    const { tasks, edits, moves, who } = await source.syncCount()
    await publish()
    const message = `${tasks} tâche${tasks > 1 ? 's' : ''} Plane pour ${who}${edits || moves ? `, ${edits + moves} changement${edits + moves > 1 ? 's' : ''} de ta part` : ''}`
    ctx.logger.info(message)
    return { message }
  }
  // An action changed a work item in the mirror: the core sees it at once.
  const after = async <T>(work: Promise<T>) => {
    const done = await work
    await publish()
    return done
  }

  ctx.objects.provide('task', {
    'task.move': (task, { status }) => after(source.move(task.remoteId, status)),
    'task.comment': (task, { text }) => source.comment(task.remoteId, text),
    // Taking a work item on is Plane's own interface's work: one the mirror has is the user's already.
    'task.join': async ({ remoteId }) => {
      await source.join(remoteId)
      const id = (await ctx.objects.idsOf('task', await account())).get(remoteId)
      if (!id) throw new Error('Cette tâche Plane n’est pas encore dans Bidule : synchronise d’abord')
      return id
    },
    'task.page': (task) => source.page(task.remoteId),
    // The user's work items whose title holds the text, as the mirror has them (assigned to the user: responsible).
    'task.search': async ({ q }) => {
      const groups = new Map((await mirror.columns()).map((c) => [c.name, c.group]))
      return (await source.search(q)).map((t) => ({
        remoteId: t.id,
        ref: t.ref,
        url: t.url,
        title: t.title,
        status: t.status,
        group: groups.get(t.status) ?? 'todo',
        due: t.due,
        people: t.people,
        role: 'owner' as const,
      }))
    },
    'task.sync': async () => {
      await sync()
    },
  })
  ctx.commands.register('lunar-industries-plane.sync', sync)

  const quietly = () => {
    void (async () => {
      if (await source.configured()) await sync()
    })().catch((error) =>
      ctx.logger.warn(`synchro Plane : ${error instanceof Error ? error.message : String(error)}`)
    )
  }
  quietly()
  setInterval(quietly, SYNC_EVERY).unref()
}
