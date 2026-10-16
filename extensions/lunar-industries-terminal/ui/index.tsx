import { useEffect } from 'react'
import { navigate, react, setPageCount, type ExtensionUi } from '@bidule/sdk'
import type { TerminalMark } from '../contract.ts'
import { PAGE } from './page.ts'
import { syncScripts } from './script-commands.ts'
import { TerminalPage } from './TerminalPage.tsx'
import { terminals } from './tabs.ts'

// The scripts of the active tab's repo, in the command palette.
syncScripts(terminals)

// Always there: the Terminal's tab counts the terminals waiting for the user's answer (Claude Code asking), seen from
// every page.
function Background() {
  useEffect(() => {
    let shown = -1
    const count = () => {
      const n = terminals.waiting()
      if (n === shown) return
      shown = n
      setPageCount(PAGE, n)
    }
    count()
    const off = terminals.subscribe(count)
    return () => {
      off()
    }
  }, [])
  return null
}

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
    'terminal.folders': () => [...terminals.folders()],
    'terminal.mark': (args) => {
      const { folder, state, label } = args as { folder: string; state: TerminalMark | null; label?: string }
      terminals.mark(folder, state, label)
    },
    // Git's page: a shell on a branch, named after it.
    'terminal.branch': async (args) => {
      const { repo, name } = args as { repo: string; name: string }
      const res = await fetch('/api/ext/lunar-industries-terminal/branches/session', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, name }),
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
