import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { BranchesService } from './service.ts'

// For the controller, once started (its page's first request starts it).
export let service: BranchesService

export async function activate(ctx: ServerContext) {
  // The branches, their task and the settings the modules share are lunar-industries-common's (a dependency).
  const { commands } = ctx
  service = new BranchesService({
    objects: ctx.objects,
    shared: {
      branches: (filter) => commands.execute('lunar-industries-common.branches', filter),
      link: (args) => commands.execute('lunar-industries-common.link', args),
      settings: () => commands.execute('lunar-industries-common.settings', undefined),
      setTarget: (args) => commands.execute('lunar-industries-common.setTarget', args),
    },
    changed: () => void ctx.events.emit('lunar-industries-branches.changed', {}),
  })
}
