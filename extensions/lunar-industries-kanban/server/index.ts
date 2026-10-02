import type { ServerContext } from '@bidule/api/extensions'
import '@bidule/ext-git/contract'
import '@bidule/ext-lunar-industries-branches/contract'
import '../contract.ts'
import { DEFAULT_HIDDEN, KanbanService } from './service.ts'

// For the controller, once started (its page's first request starts it).
export let service: KanbanService

export function activate(ctx: ServerContext) {
  // The git role is optional (`uses`): without it, the board shows no branch.
  service = new KanbanService(
    async () => (ctx.has('git') ? ctx.use('git') : null),
    // One setting for every module of the suite: the Branches module's « Branches d'intégration ». An extension cannot read
    // another's settings, so it is asked by that module's command; without the module, the defaults.
    async () => {
      try {
        return (await ctx.commands.execute('lunar-industries-branches.shared', {})).integration.join(', ')
      } catch {
        return DEFAULT_HIDDEN
      }
    }
  )
}
