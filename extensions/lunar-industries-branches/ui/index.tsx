import { useEffect } from 'react'
import { on, type ExtensionUi } from '@bidule/sdk'
import '../contract.ts'
import { api } from './api.ts'
import { BranchesPage } from './BranchesPage.tsx'
import { openBranch } from './state.ts'
import { branchKey, turnedRed } from './steps.ts'
import './branches.css'

/**
 * Always there: the branches read again whenever git reads the repos, a link changes (a task, a branch) or a forge
 * reads a review or a CI. A CI that turns red is told by the system while the window is not in front, once per
 * pipeline; a click opens its branch.
 */
function Background() {
  useEffect(() => {
    const seen = new Map<string, string>()
    const read = () =>
      void api.list().then(
        (l) => {
          const red = turnedRed(seen, l.branches)
          if (!red.length || document.hasFocus() || typeof Notification === 'undefined') return
          for (const b of red) {
            const n = new Notification(`La CI de ${b.name} est rouge`, {
              body: `${b.repoLabel} · le pipeline de son dernier commit a échoué. Clique pour ouvrir la branche.`,
              tag: `lunar-industries-branches:${branchKey(b)}:${b.headSha ?? ''}`,
            })
            n.onclick = () => {
              window.focus()
              openBranch(branchKey(b))
            }
          }
        },
        () => undefined,
      )
    read()
    const offs = [
      on('git.changed', read),
      on('objects.changed', ({ type }) => {
        if (type === 'review' || type === 'pipeline' || type === 'task' || type === 'branch') read()
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])
  return null
}

const ui: ExtensionUi = { pages: { branches: BranchesPage }, background: Background }
export default ui
