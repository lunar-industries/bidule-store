import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { DEFAULT_HIDDEN, KanbanService } from './service.ts'

// For the controller, once started (its page's first request starts it).
export let service: KanbanService

export function activate(ctx: ServerContext) {
  // Branches are optional (`needs`): without a provider of them, the board shows no branch.
  service = new KanbanService(ctx.objects, async () =>
    String((await ctx.settings.get('lunar-industries-kanban.hiddenBranches')) ?? DEFAULT_HIDDEN)
  )
}
