import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { linkByHand, setTasksByHand, sharedBranches } from './branches.ts'
import { CommonError } from './errors.ts'
import { readShared, TARGETS, withTarget } from './settings.ts'
import { filterValidator, linkValidator, setTasksValidator, targetValidator } from './validators.ts'

// Started on demand, by the first command a module runs: it keeps nothing of its own besides its settings.
export function activate(ctx: ServerContext) {
  const shared = () => readShared((key) => ctx.settings.get(key))

  ctx.commands.register('lunar-industries-common.branches', async (args) => {
    const filter = await filterValidator.validate(args)
    const integration = new Set((await shared()).integrationBranches.map((n) => n.toLowerCase()))
    return sharedBranches(ctx.objects, integration, filter)
  })

  ctx.commands.register('lunar-industries-common.link', async (args) => {
    const { repo, name, taskId } = await linkValidator.validate(args)
    return { linked: await linkByHand(ctx.objects, repo, name, taskId) }
  })

  ctx.commands.register('lunar-industries-common.setTasks', async (args) => {
    const { repo, name, taskIds } = await setTasksValidator.validate(args)
    return { linked: await setTasksByHand(ctx.objects, repo, name, taskIds) }
  })

  ctx.commands.register('lunar-industries-common.settings', shared)

  // A repo the core knows only; every page that shows the targets hears it (`lunar-industries-common.changed`).
  ctx.commands.register('lunar-industries-common.setTarget', async (args) => {
    const { repo, target } = await targetValidator.validate(args)
    const [known] = await ctx.objects.list('repository', { where: { path: repo } })
    if (!known) throw new CommonError('Dépôt inconnu', 404)
    await ctx.settings.set(TARGETS, withTarget((await shared()).targets, repo, target))
    await ctx.events.emit('lunar-industries-common.changed', {})
  })
}
