import { useId, useMemo, useState } from 'react'
import { Modal, openDialog, type Task } from '@bidule/sdk'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Asks which task a session goes to: a search over the user's tasks (title or reference), the arrows go through the
 * results, Enter or « Rattacher » picks the one chosen. Nothing is attached before that. Null when the user closes it.
 */
export function pickTask(tasks: Task[], current: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    openDialog((close) => {
      const done = (id: string | null) => {
        if (settled) return
        settled = true
        close()
        resolve(id)
      }
      return (
        <Modal label="Rattacher la session à une tâche" onClose={() => done(null)}>
          <TaskPick tasks={tasks} current={current} onDone={done} />
        </Modal>
      )
    })
  })
}

function TaskPick({ tasks, current, onDone }: { tasks: Task[]; current: string | null; onDone: (id: string | null) => void }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => {
    const q = fold(query.trim())
    return tasks.filter((t) => t.id !== current && (!q || fold(`${t.title} ${t.ref ?? ''}`).includes(q))).slice(0, 8)
  }, [tasks, current, query])
  const chosen = results[active] ?? null
  return (
    <div className="lc-pick">
      <h2>Rattacher la session à une tâche</h2>
      <label className="field">
        Chercher une tâche
        <input
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={chosen ? `${id}-${active}` : undefined}
          autoComplete="off"
          autoFocus
          placeholder="Titre ou référence"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive((a) => Math.min(Math.max(a + step, 0), Math.max(results.length - 1, 0)))
            } else if (e.key === 'Enter' && chosen) {
              e.preventDefault()
              onDone(chosen.id)
            }
          }}
        />
      </label>
      {results.length ? (
        <ul className="lc-pick-list" role="listbox" id={`${id}-list`} aria-label="Tâches">
          {results.map((t, i) => (
            <li
              key={t.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`menu-item lc-pick-item${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setActive(i)}
              onDoubleClick={() => onDone(t.id)}
            >
              {t.ref && <span className="card-id">{t.ref}</span>}
              <span className="ellipsis grow">{t.title}</span>
              <span className="legend">{t.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" role="status">
          {tasks.length ? `Aucune tâche ne correspond à « ${query.trim()} ».` : 'Aucune tâche à rattacher : aucun outil ne fournit tes tâches.'}
        </p>
      )}
      <p className="legend">Les flèches parcourent la liste, Entrée rattache la tâche choisie. Rien n’est rattaché avant.</p>
      <div className="row">
        <span className="grow" />
        <button type="button" className="btn" onClick={() => onDone(null)}>
          Annuler
        </button>
        <button type="button" className="btn-cta" disabled={!chosen} onClick={() => chosen && onDone(chosen.id)}>
          Rattacher
        </button>
      </div>
    </div>
  )
}
