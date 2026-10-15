import { useEffect } from 'react'
import { readTasks, setPageCount, useOn, type ExtensionUi } from '@bidule/sdk'
import '../contract.ts'
import { Kanban } from './KanbanPage.tsx'
import { KanbanSettings } from './KanbanSettings.tsx'
import { dayKey, daysLeft } from './layout.ts'
import './kanban.css'

// The page's counter, seen from any page: the unfinished tasks late or due today. Read again whenever the core says
// the tasks changed; a reading that fails leaves the counter as it was.
function Count() {
  const count = () =>
    void readTasks().then(
      (board) => {
        const today = dayKey(new Date())
        const due = board.source === null ? [] : board.tasks.filter((t) => t.group !== 'done' && (daysLeft(t, today) ?? 1) <= 0)
        setPageCount('/lunar-industries/kanban', due.length || null)
      },
      () => undefined,
    )
  useEffect(count, [])
  useOn('objects.changed', ({ type }) => {
    if (type === 'task') count()
  })
  return null
}

// Simon's Kanban: a module on the core's tasks (and branches for the cards), in place of the official one.
const ui: ExtensionUi = {
  pages: { kanban: Kanban },
  settings: KanbanSettings,
  background: Count,
}
export default ui
