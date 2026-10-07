import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { DbMirror } from './mirror.ts'
import { PlaneTasks } from './source.ts'
import { listOf } from './states.ts'

// Every 10 minutes: Plane changes without telling.
const SYNC_EVERY = 10 * 60_000

// Started with the app (`onStartup`): it keeps the mirror of the user's work items up to date.
export async function activate(ctx: ServerContext) {
  const setting = async (name: string) => String((await ctx.settings.get(`${ctx.id}.${name}`)) ?? '')
  const config = async () => ({
    url: await setting('url'),
    workspace: await setting('workspace'),
    projects: listOf(await setting('projects')),
    key: await ctx.secrets.get(`${ctx.id}.token`),
  })

  // The tasks the other providers show (Notion's), by lowercase id: a work item whose description names one is its
  // copy. A core that does not combine providers (before several could hold `tasks`) has no other to ask.
  const others = async () => {
    const found = new Map<string, string>()
    const providers = typeof ctx.useAll === 'function' ? await ctx.useAll('tasks') : []
    for (const { provider, impl } of providers) {
      if (provider === ctx.id) continue
      for (const task of (await impl.board()).tasks) found.set(task.id.toLowerCase(), task.id)
    }
    return found
  }

  const source = new PlaneTasks(config, new DbMirror(ctx.db), others)
  ctx.provide('tasks', source)

  const sync = async () => {
    const { tasks, edits, moves, who } = await source.syncCount()
    await ctx.events.emit('tasks.changed', {})
    const message = `${tasks} tâche${tasks > 1 ? 's' : ''} Plane pour ${who}${edits || moves ? `, ${edits + moves} changement${edits + moves > 1 ? 's' : ''} de ta part` : ''}`
    ctx.logger.info(message)
    return { message }
  }
  ctx.commands.register('lunar-industries-plane.sync', sync)

  const quietly = () => {
    void (async () => {
      if (await source.configured()) await sync()
    })().catch((error) => ctx.logger.warn(`synchro Plane : ${error instanceof Error ? error.message : String(error)}`))
  }
  quietly()
  setInterval(quietly, SYNC_EVERY).unref()
}
