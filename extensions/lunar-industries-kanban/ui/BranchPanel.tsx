import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { relTime, type Task } from '@bidule/sdk'
import { useListKeys } from '@bidule/ext-lunar-industries-common/ui/list'
import type { KanbanBranch } from '../contract.ts'
import { branchKey, tasksForBranch } from './layout.ts'

/**
 * The recent branches without a task (maquette « Kanban Lunar », Lier des branches), in a panel at the window's right
 * edge rather than above the board: grouped by repo, their full names, the task a branch is still linked to when the
 * board does not show it. A branch is dragged onto a card, or linked here: Enter (or a click) opens a search of the
 * tasks, the likeliest first (its name's words), and Enter links the one chosen. Escape closes the search, then the
 * panel.
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
  const ids = branches.map(branchKey)
  const { rowProps, focus } = useListKeys({
    ids,
    active,
    setActive,
    onOpen: (id) => setPicking(id),
  })
  const box = useRef<HTMLElement>(null)
  // The first branch has the focus when the panel opens.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return
    e.preventDefault()
    e.stopPropagation()
    close()
  }
  const repos = [...new Set(branches.map((b) => b.repoLabel))]
  return (
    <aside ref={box} className="lik-panel" aria-label="Branches sans tâche" onKeyDown={onKeyDown}>
      <header className="lik-panel-head">
        <div className="row">
          <h2 className="grow">Branches sans tâche</h2>
          <button type="button" className="icon-btn" aria-label="Fermer (Échap)" title="Fermer (Échap)" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="legend">
          Les branches récentes qu'aucune tâche du tableau ne réclame. Glisse-en une sur une carte, ou choisis sa tâche
          ici.
        </p>
      </header>
      <div className="lik-panel-body">
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
                      {b.taskId && <span className="lik-panel-note">liée à {titleOf(b.taskId)}, que le tableau ne montre pas</span>}
                      {picking === key && (
                        <TaskPicker
                          branch={b}
                          tasks={tasks}
                          done={done}
                          pick={async (task) => {
                            await link(b, task)
                            setPicking(null)
                          }}
                          cancel={() => {
                            setPicking(null)
                            focus(key)
                          }}
                        />
                      )}
                    </li>
                  )
                })}
            </ul>
          </section>
        ))}
      </div>
      <footer className="lik-panel-foot legend">
        <span>
          <kbd>↑ ↓</kbd> choisir
        </span>
        <span>
          <kbd>Entrée</kbd> lier à une tâche
        </span>
        <span>
          <kbd>Échap</kbd> fermer
        </span>
      </footer>
    </aside>
  )
}

// The search of a branch's task: a field and the tasks found, the arrows to choose, Enter to link, Escape to give up.
function TaskPicker({
  branch,
  tasks,
  done,
  pick,
  cancel,
}: {
  branch: KanbanBranch
  tasks: readonly Task[]
  done: (task: Task) => boolean
  pick: (task: Task) => Promise<void>
  cancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const found = tasksForBranch(tasks, branch.name, query, done)
  const chosen = found[Math.min(at, found.length - 1)]
  const listId = `lik-pick-${branchKey(branch).replace(/\W/g, '-')}`
  const go = async (task: Task | undefined) => {
    if (!task || busy) return
    setBusy(true)
    try {
      await pick(task)
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setAt((i) => Math.min(i + 1, found.length - 1)),
      ArrowUp: () => setAt((i) => Math.max(i - 1, 0)),
      Enter: () => void go(chosen),
      Escape: cancel,
    }
    if (!keys[e.key]) return
    e.preventDefault()
    e.stopPropagation()
    keys[e.key]()
  }
  return (
    <div className="lik-picker" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={chosen ? `${listId}-${chosen.id}` : undefined}
        aria-label={`Tâche de ${branch.name}`}
        placeholder="Titre ou référence de la tâche…"
        value={query}
        disabled={busy}
        onChange={(e) => {
          setQuery(e.target.value)
          setAt(0)
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Tâches" className="lik-picker-list">
        {found.map((t) => (
          <li
            key={t.id}
            id={`${listId}-${t.id}`}
            role="option"
            aria-selected={t === chosen}
            className={`menu-item lik-picker-item${t === chosen ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void go(t)}
          >
            {t.ref && <span className="mono legend">{t.ref}</span>}
            <span className="grow">{t.title}</span>
            {done(t) && <span className="legend">terminée</span>}
          </li>
        ))}
        {!found.length && <li className="legend lik-picker-none">Aucune tâche ne correspond.</li>}
      </ul>
    </div>
  )
}
