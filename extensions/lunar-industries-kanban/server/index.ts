import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { KanbanService } from './service.ts'

// For the controller, once started (its page's first request starts it).
export let service: KanbanService

export function activate(ctx: ServerContext) {
  // Branches are optional (`needs`): without a provider of them, the board shows no branch. They are read and linked
  // through lunar-industries-common (a dependency), which puts them together for every Lunar Industries module.
  service = new KanbanService(ctx.objects, {
    branches: (filter) => ctx.commands.execute('lunar-industries-common.branches', filter),
    link: (args) => ctx.commands.execute('lunar-industries-common.link', args),
  })
}
