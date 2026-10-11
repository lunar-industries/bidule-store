import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { BranchesService } from './service.ts'

// For the controller, once started (its page's first request starts it).
export let service: BranchesService

export async function activate(ctx: ServerContext) {
  service = new BranchesService({
    objects: ctx.objects,
    setting: (key) => ctx.settings.get(key),
    save: (key, value) => ctx.settings.set(key, value),
    changed: () => void ctx.events.emit('lunar-industries-branches.changed', {}),
  })
}
