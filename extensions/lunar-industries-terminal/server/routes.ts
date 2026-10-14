import type { Router } from '@adonisjs/core/http'

const terminal = () => import('@bidule/ext-lunar-industries-terminal/server/controllers/terminal_controller')

// Mounted under /api/ext/terminal, named ext.terminal.….
export default function routes(router: Router) {
  router.get('scripts', [terminal, 'scripts']).as('scripts')
  router.post('scripts/run', [terminal, 'run']).as('scripts.run')
  router.get('review', [terminal, 'review']).as('review')
  router.post('tasks/:id/session', [terminal, 'task']).as('tasks.session')
  router.post('branches/session', [terminal, 'branch']).as('branches.session')
}
