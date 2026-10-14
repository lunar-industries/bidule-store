import type { ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { TerminalService } from './service.ts'

// For the controller, once started (its first request starts it).
export let service: TerminalService

export async function activate(ctx: ServerContext) {
  service = new TerminalService(ctx)
}
