import type { HttpContext } from '@adonisjs/core/http'
import type { ScriptValues } from '../../scripts-file.ts'
import { TerminalError } from '@bidule/ext-lunar-industries-terminal/server/errors'
import { service } from '@bidule/ext-lunar-industries-terminal/server/index'
import { branchValidator, reviewValidator, runValidator, scriptsValidator } from '@bidule/ext-lunar-industries-terminal/server/validators'

// What the terminal's tabs ask of the other roles: a repo's scripts, a review's address, a task's shell.
export default class TerminalController {
  // The scripts of the repo asked for, else of the repo of `cwd` (a tab's folder), none outside a repo; and the known
  // repos.
  async scripts({ request }: HttpContext) {
    const { cwd, repo } = await request.validateUsing(scriptsValidator)
    return service.scripts(cwd, repo)
  }

  // One of them in a new tab: the session the terminal opens (command `terminal.open`).
  async run({ request }: HttpContext) {
    const { repo, source, runner, name, values } = await request.validateUsing(runValidator)
    if (source === 'file') return service.runFile(repo, name, (values ?? {}) as ScriptValues)
    if (!runner) throw new TerminalError('Quel outil lance ce script ?', 422)
    return service.run(repo, runner, name)
  }

  async review({ request }: HttpContext) {
    const { cwd, kind, number } = await request.validateUsing(reviewValidator)
    return { url: await service.reviewUrl(cwd, kind, number) }
  }

  async task({ params }: HttpContext) {
    return service.taskShell(String(params.id))
  }

  async branch({ request }: HttpContext) {
    const { branchId } = await request.validateUsing(branchValidator)
    return service.branchShell(branchId)
  }
}
