import { useId, useState } from 'react'
import { navigate, type Task } from '@bidule/sdk'
import type { ListedBranch } from '../contract.ts'
import { findTasks } from './steps.ts'

/**
 * Taken from quack-board (Simon's task-picker): a field that finds a task as one types (title, reference, branch),
 * 8 at most, those not done first. It shows the task chosen; typing replaces it, leaving without a pick puts it back.
 * When nothing can be picked, the list says why: no task found, or no extension giving tasks.
 */
export function TaskPicker({
  label,
  tasks,
  done,
  branches,
  current,
  noSource,
  picked,
}: {
  label: string
  tasks: Task[]
  done: Set<string>
  branches: ListedBranch[]
  current: string
  // No extension provides tasks.
  noSource: boolean
  picked: (id: string) => void
}) {
  const id = useId()
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const open = query !== null
  // The current task's own title searches nothing: the list then offers every task.
  const search = query === current ? '' : (query ?? '')
  const results = open ? findTasks(tasks, done, branches, search) : []
  const choose = (task: Task | undefined) => {
    if (!task) return
    picked(task.id)
    setQuery(null)
  }
  const note = !open ? null : noSource ? 'none' : !results.length ? (search.trim() ? `Aucune tâche trouvée pour « ${search.trim()} ».` : 'Aucune tâche.') : null
  return (
    // The list closes when the focus leaves the field and its list, not when it goes to the list's button.
    <div
      className="lib-picker"
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setQuery(null)
      }}
    >
      <label className="field">
        {label}
        <input
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          placeholder="Chercher une tâche (titre, ID, branche)…"
          value={query ?? current}
          onFocus={(e) => {
            setQuery(current)
            setActive(0)
            e.currentTarget.select()
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)))
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
            else if (e.key === 'Enter') choose(results[active])
            else if (e.key === 'Escape') {
              e.stopPropagation()
              setQuery(null)
              e.currentTarget.blur()
            } else return
            e.preventDefault()
          }}
        />
      </label>
      {open && results.length > 0 && (
        <div id={`${id}-list`} role="listbox" className="menu lib-picker-list">
          {results.map((t, i) => (
            <div
              key={t.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`menu-item lib-picker-item${i === active ? ' active' : ''}`}
              // Before the field's blur: the choice is made while the list is still there.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(t)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {t.ref && <span className="card-id">{t.ref}</span>}
              <span className="ellipsis grow">{t.title}</span>
            </div>
          ))}
        </div>
      )}
      {note && (
        <div className="menu lib-picker-list lib-picker-note" role="status">
          {note === 'none' ? (
            <>
              <span className="muted">Aucun module de tâches actif : active Notion ou un autre outil de tâches.</span>
              <button type="button" className="btn lib-btn-sm" onClick={() => navigate('/reglages/extensions')}>
                Réglages › Extensions
              </button>
            </>
          ) : (
            <span className="muted">{note}</span>
          )}
        </div>
      )}
    </div>
  )
}
