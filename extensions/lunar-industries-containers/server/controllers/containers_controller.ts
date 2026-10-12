import type { HttpContext } from '@adonisjs/core/http'
import { docker, selection } from '@bidule/ext-lunar-industries-containers/server/index'
import {
  actionValidator,
  filesValidator,
  selectionValidator,
  terminalValidator,
  unfollowValidator,
} from '@bidule/ext-lunar-industries-containers/server/validators'

// How many of its last lines a container's logs start with, before the new ones.
const LOG_TAIL = 500

// The user's containers (Docker, Podman) through the `docker` extension: the list, a container's view, what they use,
// acting on them, a terminal on them, their logs followed, what is ticked (the only thing kept here).
export default class ContainersController {
  async index() {
    return docker.list()
  }

  // What the containers use, followed while the page shows it: the follow's id and the last measure, then events.
  async followUsage() {
    return docker.usage()
  }

  async show({ params }: HttpContext) {
    return docker.inspect(params.engine, params.id)
  }

  async act({ params, request }: HttpContext) {
    const { action } = await request.validateUsing(actionValidator)
    if (action === 'remove') await docker.remove(params.engine, params.id)
    else await docker.act(params.engine, params.id, action)
    return { ok: true as const }
  }

  // A shell inside or the logs: the terminal opens the session (command `terminal.open`).
  async terminal({ params, request }: HttpContext) {
    const { kind } = await request.validateUsing(terminalValidator)
    return { session: await docker.terminal(params.engine, params.id, kind) }
  }

  // A container's logs followed while the page shows them: the follow's id and the lines read so far, then events.
  async followLogs({ params }: HttpContext) {
    return docker.logs(params.engine, params.id, LOG_TAIL)
  }

  async unfollow({ request }: HttpContext) {
    const { params } = await request.validateUsing(unfollowValidator)
    await docker.unfollow(params.follow)
    return { ok: true as const }
  }

  async files({ params, request }: HttpContext) {
    const { path } = await request.validateUsing(filesValidator)
    return { files: await docker.files(params.engine, params.id, path) }
  }

  async selection() {
    return { keys: await selection.keys() }
  }

  async select({ request }: HttpContext) {
    const { keys } = await request.validateUsing(selectionValidator)
    await selection.save(keys)
    return { ok: true as const }
  }
}
