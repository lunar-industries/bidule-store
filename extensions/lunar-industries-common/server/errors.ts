import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

// What the module refuses (a repo the core does not know), as `{ error }` with its status when the interface ran the
// command; a module that ran it gets the exception.
export class CommonError extends Exception {
  constructor(message: string, status = 422) {
    super(message, { status })
  }

  async handle(error: this, ctx: HttpContext) {
    ctx.response.status(error.status).send({ error: error.message })
  }
}
