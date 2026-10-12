import { homedir } from 'node:os'
import type { HttpContext } from '@adonisjs/core/http'
import { prepare, service } from '@bidule/ext-lunar-industries-containers/server/index'
import {
  actionValidator,
  filesValidator,
  selectionValidator,
  terminalValidator,
  unfollowValidator,
} from '@bidule/ext-lunar-industries-containers/server/validators'

// The user's containers (Docker, Podman): the list, a container's view, what they use, acting on them, a terminal on
// them, their logs followed, what is ticked.
export default class ContainersController {
  async index() {
    return service.list()
  }

  // What the containers use, followed while the page shows it: the follow's id and the last measure, then events.
  async followUsage() {
    return service.followUsage()
  }

  async show({ params }: HttpContext) {
    return service.detail(params.engine, params.id)
  }

  async act({ params, request }: HttpContext) {
    const { action } = await request.validateUsing(actionValidator)
    await service.act(params.engine, params.id, action)
    return { ok: true as const }
  }

  // A shell inside or the logs: the terminal opens the session (command `terminal.open`).
  async terminal({ params, request }: HttpContext) {
    const { kind } = await request.validateUsing(terminalValidator)
    return { session: prepare(await service.launch(params.engine, params.id, kind, homedir())) }
  }

  // A container's logs followed while the page shows them: the follow's id and the lines read so far, then events.
  async followLogs({ params }: HttpContext) {
    return service.followLogs(params.engine, params.id)
  }

  async unfollow({ request }: HttpContext) {
    const { params } = await request.validateUsing(unfollowValidator)
    service.unfollow(params.follow)
    return { ok: true as const }
  }

  async files({ params, request }: HttpContext) {
    const { path } = await request.validateUsing(filesValidator)
    return { files: await service.files(params.engine, params.id, path) }
  }

  async selection() {
    return { keys: await service.selection() }
  }

  async select({ request }: HttpContext) {
    const { keys } = await request.validateUsing(selectionValidator)
    await service.select(keys)
    return { ok: true as const }
  }
}
