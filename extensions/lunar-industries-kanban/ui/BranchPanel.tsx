import { useEffect, useRef, useState, type DragEvent } from 'react'
import { relTime, type Task } from '@bidule/sdk'
import { useListKeys } from '@bidule/ext-lunar-industries-common/ui/list'
import { SidePanel } from '@bidule/ext-lunar-industries-common/ui/panel'
import { TaskField } from '@bidule/ext-lunar-industries-common/ui/tasks'
import type { KanbanBranch } from '../contract.ts'
import { branchKey } from './layout.ts'

/**
 * The recent branches without a task (maquette « Kanban Lunar », Lier des branches), in the common side panel, over
 * the board: grouped by repo, their full names, the task a branch is still linked to when the board does not show it.
 * A branch is dragged onto a card, or linked here: Enter (or a click) opens the common task field, the likeliest
 * tasks first (its name's words), and Enter links the one chosen. Escape closes the field, then the panel; a click
 * outside it closes it too, except on the banner's button that toggles it.
 */
export function BranchPanel({
  branches,
  tasks,
  titleOf,
  done,
  link,
  drag,
  close,
}: {
  branches: KanbanBranch[]
  tasks: readonly Task[]
  // The task a branch is still linked to, when the board does not show it.
  titleOf: (taskId: string) => string
  done: (task: Task) => boolean
  link: (branch: KanbanBranch, task: Task) => Promise<void>
  drag: (e: DragEvent<HTMLElement>, branch: KanbanBranch) => void
  close: () => void
}) {
  const [active, setActive] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = branches.map(branchKey)
  const { rowProps, focus } = useListKeys({
    ids,
    active,
    setActive,
    onOpen: (id) => setPicking(id),
  })
  const box = useRef<HTMLDivElement>(null)
  // The first branch has the focus when the panel opens.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [])
  const pick = async (b: KanbanBranch, task: Task) => {
    if (busy) return
    setBusy(true)
    try {
      await link(b, task)
      setPicking(null)
    } finally {
      setBusy(false)
    }
  }
  const repos = [...new Set(branches.map((b) => b.repoLabel))]
  return (
    <SidePanel
      title="Branches sans tâche"
      subtitle="Les branches récentes qu'aucune tâche du tableau ne réclame. Glisse-en une sur une carte, ou choisis sa tâche ici."
      keys={[
        ['↑ ↓', 'choisir'],
        ['Entrée', 'lier à une tâche'],
        ['Échap', 'fermer'],
      ]}
      keepOpenOn=".lik-panel-toggle"
      onClose={close}
    >
      <div ref={box} className="lik-panel-content">
        {!branches.length && <p className="muted">Toutes les branches récentes ont leur tâche.</p>}
        {repos.map((repo) => (
          <section key={repo} aria-label={repo} className="lik-panel-repo">
            <h3 className="legend">{repo}</h3>
            <ul className="lik-panel-list" role="list">
              {branches
                .filter((b) => b.repoLabel === repo)
                .map((b) => {
                  const key = branchKey(b)
                  return (
                    <li
                      key={key}
                      className={`lik-panel-row${picking === key ? ' picking' : ''}`}
                      draggable
                      onDragStart={(e) => drag(e, b)}
                      onClick={(e) => e.target === e.currentTarget && setPicking(key)}
                      {...rowProps(key)}
                    >
                      <div className="row lik-panel-line" onClick={() => setPicking(key)}>
                        <span className="mono grow ellipsis" title={b.name}>
                          {b.name}
                        </span>
                        <span className="legend">{relTime(b.lastCommitAt)}</span>
                      </div>
                      {b.taskIds.length > 0 && (
                        <span className="lik-panel-note">
                          liée à {b.taskIds.map(titleOf).join(', ')}, que le tableau ne montre pas
                        </span>
                      )}
                      {picking === key && (
                        // A click in the field stays in the field: not a click on the row.
                        <div onClick={(e) => e.stopPropagation()}>
                          <TaskField
                            label={`Tâche de ${b.name}`}
                            hideLabel
                            inline
                            autoFocus
                            placeholder="Titre ou référence de la tâche…"
                            tasks={tasks}
                            done={done}
                            hint={b.name}
                            disabled={busy}
                            onPick={(task) => void pick(b, task)}
                            onCancel={() => {
                              setPicking(null)
                              focus(key)
                            }}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
            </ul>
          </section>
        ))}
      </div>
    </SidePanel>
  )
}
