import { navigate, react, type ExtensionUi } from '@bidule/sdk'
import '../contract.ts'
import { PAGE } from './page.ts'
import { syncScripts } from './script-commands.ts'
import { TerminalPage } from './TerminalPage.tsx'
import { terminals } from './tabs.ts'

// The scripts of the active tab's repo, in the command palette.
syncScripts(terminals)

// Loaded with the app (its `background`, which draws nothing): the scripts reach the palette, and the marks the other
// extensions put on the tabs are kept, before the page is ever visited.
const Background = () => null

const ui: ExtensionUi = {
  background: Background,
  pages: { terminal: TerminalPage },
  commands: {
    'terminal.new': async () => {
      navigate(PAGE)
      await terminals.add()
    },
    // What another extension prepared (ctx.terminal.prepare): a tab for it, then the page.
    'terminal.open': async (args) => {
      const { session, title, folder } = args as { session: string; title: string; folder?: string }
      await terminals.add({ session }, title, folder)
      navigate(PAGE)
    },
    // Git's page: a shell on a branch, named after it.
    'terminal.branch': async (args) => {
      const { branchId } = args as { branchId: string }
      const res = await fetch('/api/ext/lunar-industries-terminal/branches/session', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId }),
      })
      const body = (await res.json().catch(() => ({}))) as { session?: string; title?: string; folder?: string; error?: string }
      if (!res.ok || !body.session) {
        const message = body.error ?? `Erreur ${res.status}`
        return void react('panic', message, message)
      }
      navigate(PAGE)
      await terminals.add({ session: body.session }, body.title, body.folder)
    },
    // The Kanban's right click: a shell where the task is worked on, named after it.
    'terminal.task': async (args) => {
      const { taskId } = args as { taskId: string }
      const res = await fetch(`/api/ext/lunar-industries-terminal/tasks/${encodeURIComponent(taskId)}/session`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const body = (await res.json().catch(() => ({}))) as { session?: string; title?: string; folder?: string; error?: string }
      if (!res.ok || !body.session) {
        const message = body.error ?? `Erreur ${res.status}`
        return void react('panic', message, message)
      }
      navigate(PAGE)
      await terminals.add({ session: body.session }, body.title, body.folder)
    },
  },
}
export default ui
