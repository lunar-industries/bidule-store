import type { ServerContext } from '@bidule/api/extensions'
import type { GitSource } from '@bidule/ext-git/contract'
import '../contract.ts'
import { BranchesError } from './errors.ts'
import { IssueLinks } from './issue_links.ts'
import { BranchesService } from './service.ts'

// For the controller.
export let service: BranchesService

export async function activate(ctx: ServerContext) {
  // The branches, their task and the settings the modules share are lunar-industries-common's (a dependency).
  const { commands } = ctx
  const settings = () => commands.execute('lunar-industries-common.settings', undefined)
  service = new BranchesService({
    objects: ctx.objects,
    shared: {
      branches: (filter) => commands.execute('lunar-industries-common.branches', filter),
      setTasks: (args) => commands.execute('lunar-industries-common.setTasks', args),
      settings,
      setTarget: (args) => commands.execute('lunar-industries-common.setTarget', args),
    },
    // git's push (the module needs git): a git too old to push says so.
    git: {
      push: async (repo, branch) => {
        const git = ctx.objects.client<GitSource>('git')
        if (!git.push) throw new BranchesError('Le connecteur git ne sait pas encore pousser : mets-le à jour', 501)
        return git.push(repo, branch)
      },
    },
  })
  // Started with the app (activation), so that a branch named after its issue is linked without the page open.
  const { objects } = ctx
  const issues = new IssueLinks({
    objects: {
      branches: (ids) => objects.list('branch', { ids }),
      tasks: () => objects.list('task'),
      forgeOf: (repositoryId) => objects.first('review.forge', { repositoryId }),
      relations: (filter) => objects.relations(filter),
      link: (from, kind, to, origin) => objects.link(from, kind, to, origin),
      unlink: (from, kind, to, origin) => objects.unlink(from, kind, to, origin),
    },
    settings,
    origin: 'lunar-industries-branches',
  })
  ctx.events.on('objects.changed', async ({ type, ids }) => {
    if (type === 'branch') await issues.branchesChanged(ids)
    else if (type === 'task') await issues.tasksChanged()
  })
}
