import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { Days } from './days.ts'
import { readSettings } from './settings.ts'
import { DbStore, mergeListener } from './store.ts'
import { coreTimeLog, coreWork } from './work.ts'

// For the controller, once started (its page's first request starts it).
export let days: Days

// The objects whose changes move today's proposal: the activity, the branches and their links, the tasks.
const FOLLOWED = new Set(['activity', 'branch', 'repository', 'task'])

export async function activate(ctx: ServerContext) {
  const store = new DbStore(ctx.db)
  days = new Days({
    store,
    settings: () => readSettings(ctx),
    // A link by hand, and the integration branches (readSettings), are lunar-industries-common's (a dependency).
    work: coreWork(ctx.objects, (args) => ctx.commands.execute('lunar-industries-common.link', args)),
    timeLog: coreTimeLog(ctx.objects),
    changed: () => void ctx.events.emit('lunar-industries-temps.changed', {}),
  })
  // The work moved on: today's proposal follows (a draft the user changed stays theirs). One read of git changes
  // several types at once: they make one more run after the one going on, not one each. Resolves once no run is left.
  let running: Promise<void> | null = null
  let again = false
  const follow = (): Promise<void> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await days.follow().catch((error: Error) => ctx.logger.warn(`Lunar Industries - Temps : ${error.message}`))
      } while (again)
    })().finally(() => {
      running = null
    })
    return running
  }
  // A change does not wait for the proposal; a merge does (it is rare, and its ids must be moved first).
  ctx.events.on('objects.changed', ({ type }) => {
    if (FOLLOWED.has(type)) void follow()
  })
  ctx.events.on('objects.merged', mergeListener(store, follow))
}
