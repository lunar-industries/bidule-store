import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { Days } from './days.ts'
import { readSettings } from './settings.ts'
import { DbStore } from './store.ts'
import { coreTimeLog, coreWork } from './work.ts'

// For the controller, once started (its page's first request starts it).
export let days: Days

// The objects whose changes move today's proposal: the activity, the branches and their links, the tasks.
const FOLLOWED = new Set(['activity', 'branch', 'repository', 'task'])

export async function activate(ctx: ServerContext) {
  days = new Days({
    store: new DbStore(ctx.db),
    settings: () => readSettings(ctx),
    work: coreWork(ctx.objects),
    timeLog: coreTimeLog(ctx.objects),
    changed: () => void ctx.events.emit('lunar-industries-temps.changed', {}),
  })
  // The work moved on: today's proposal follows (a draft the user changed stays theirs). One read of git changes
  // several types at once: they make one more run after the one going on, not one each.
  let running = false
  let again = false
  const follow = () => {
    if (running) {
      again = true
      return
    }
    running = true
    void days
      .follow()
      .catch((error: Error) => ctx.logger.warn(`Lunar Industries - Temps : ${error.message}`))
      .finally(() => {
        running = false
        if (again) {
          again = false
          follow()
        }
      })
  }
  ctx.events.on('objects.changed', ({ type }) => {
    if (FOLLOWED.has(type)) follow()
  })
}
