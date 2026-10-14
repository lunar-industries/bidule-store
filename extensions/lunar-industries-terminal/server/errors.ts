import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

// What the terminal refuses (an unknown repo or script, a task without a branch), as `{ error }` with its status.
export class TerminalError extends Exception {
  constructor(message: string, status = 409) {
    super(message, { status })
  }

  async handle(error: this, ctx: HttpContext) {
    ctx.response.status(error.status).send({ error: error.message })
  }
}
