import { useId, useMemo, useState } from 'react'
import { navigate, type Task, type TaskColumn } from '@bidule/sdk'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Why there is no task to pick from: no extension provides tasks, or they could not be read (its message).
export type TasksProblem = { kind: 'none' } | { kind: 'failed'; message: string }

// Taken from quack-board (components/task-picker, Simon's): a task found by its title or reference, eight at most,
// the tasks not done first. A combobox: the arrows go through the results, Enter picks one. When nothing can be
// picked, the list says why instead of staying shut.
export function TaskPicker({
  tasks,
  columns,
  label,
  problem,
  onPick,
}: {
  tasks: Task[]
  columns: TaskColumn[]
  label: string
  problem: TasksProblem | null
  onPick: (taskId: string) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const done = useMemo(() => new Set(columns.filter((c) => c.group === 'done').map((c) => c.name)), [columns])
  const results = useMemo(() => {
    const q = fold(query.trim())
    return tasks
      .filter((t) => !q || fold(`${t.title} ${t.ref ?? ''}`).includes(q))
      .sort((a, b) => Number(done.has(a.status)) - Number(done.has(b.status)))
      .slice(0, 8)
  }, [tasks, query, done])
  const pick = (t: Task) => {
    onPick(t.id)
    setQuery('')
    setOpen(false)
  }
  const listed = open && results.length > 0
  // What the list says when it has nothing to offer: only once the field is in use.
  const note = !open
    ? null
    : problem?.kind === 'none'
      ? 'none'
      : problem?.kind === 'failed'
        ? `Les tâches n'ont pas pu être lues : ${problem.message}`
        : !results.length && query.trim()
          ? `Aucune tâche ne correspond à « ${query.trim()} ».`
          : null
  return (
    // The list closes when the focus leaves the picker, not when it goes to the button the list holds.
    <div
      className="lit-picker"
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOpen(false)
      }}
    >
      <label className="field">
        {label}
        <input
          type="text"
          role="combobox"
          aria-expanded={listed}
          aria-controls={`${id}-list`}
          aria-activedescendant={listed && results[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          placeholder="Titre ou référence"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && listed && results[active]) {
              e.preventDefault()
              pick(results[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
      </label>
      {listed && (
        <ul className="menu lit-picker-list" role="listbox" id={`${id}-list`} aria-label={label}>
          {results.map((t, i) => (
            <li
              key={t.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`menu-item lit-picker-item${i === active ? ' active' : ''}`}
              // Before the field's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {t.ref && <span className="card-id">{t.ref}</span>}
              <span className="ellipsis grow">{t.title}</span>
              {done.has(t.status) && <span className="legend">terminée</span>}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <div className="menu lit-picker-list lit-picker-note" role="status">
          {note === 'none' ? (
            <>
              <span className="muted">Aucun fournisseur de tâches : active Notion ou un autre outil de tâches.</span>
              <button type="button" className="btn" onClick={() => navigate('/reglages/extensions')}>
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
