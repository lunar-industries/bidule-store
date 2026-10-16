import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { errorMessage, Modal, navigate, openDialog, readTasks, type Task, type TaskColumn } from '@bidule/sdk'
import './common.css'

/**
 * Choosing a task, the same in every Lunar Industries module (the « Composants communs Lunar » maquette): one search,
 * one list, the same sentences when there is nothing to choose. A field with its list under it (`TaskField`), the same
 * list always open (a row of the Kanban), or in a dialog that confirms (`pickTask`).
 */

// Without its accents and its case: « Écran » is found by « ecran ».
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Why there is no task to choose: no extension provides tasks, or they could not be read.
export type TaskProblem = { kind: 'none' } | { kind: 'failed'; message: string }

// The tasks whose status is in a « done » column.
export function doneOf(columns: readonly TaskColumn[]): (task: Task) => boolean {
  const done = new Set(columns.filter((c) => c.group === 'done').map((c) => c.name))
  return (task) => done.has(task.status)
}

export type TaskSearch = {
  done: (task: Task) => boolean
  // More text a task is found by (the names of its branches).
  also?: (task: Task) => string
  // A branch's name: the tasks sharing the most of its words come first.
  hint?: string
  // Tasks not to offer (the one already chosen).
  exclude?: readonly string[]
}

const MAX = 8
// The words a branch's name brings to find its task: its parts (`feat/TSK-142-export-csv` → tsk, 142, export, csv),
// without its kind (feat, fix…) and the words too short to mean anything.
const KINDS = new Set(['feat', 'feature', 'fix', 'hotfix', 'chore', 'docs', 'doc', 'refactor', 'test', 'tests', 'ci', 'build', 'perf', 'style'])
export const branchWords = (name: string) =>
  fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !KINDS.has(w))

/**
 * The tasks a query finds: every word typed in the title, the reference or `also`, without accents; those sharing the
 * most words with `hint` first, then those not done, each keeping the order given otherwise. Eight at most.
 */
export function findTasks(tasks: readonly Task[], query: string, { done, also, hint, exclude }: TaskSearch): Task[] {
  const typed = fold(query).split(/\s+/).filter(Boolean)
  const hinted = hint ? branchWords(hint) : []
  const text = (t: Task) => fold(`${t.ref ?? ''} ${t.title} ${also?.(t) ?? ''}`)
  return tasks
    .filter((t) => !exclude?.includes(t.id))
    .map((task, i) => ({ task, i, text: text(task) }))
    .filter(({ text }) => typed.every((w) => text.includes(w)))
    .map((r) => ({ ...r, score: hinted.filter((w) => r.text.includes(w)).length, done: done(r.task) }))
    .sort((a, b) => b.score - a.score || Number(a.done) - Number(b.done) || a.i - b.i)
    .slice(0, MAX)
    .map(({ task }) => task)
}

/**
 * The user's tasks, read once (and again by `retry`): null while they are read; `problem` when there are none to read
 * (no extension provides them) or the reading failed, said as such rather than as an empty list.
 */
export function useTaskBoard() {
  const [state, setState] = useState<{ tasks: Task[] | null; columns: TaskColumn[]; problem: TaskProblem | null }>({
    tasks: null,
    columns: [],
    problem: null,
  })
  const retry = useCallback(() => {
    setState((s) => ({ ...s, problem: null }))
    readTasks().then(
      (board) =>
        setState(
          board.source === null
            ? { tasks: [], columns: [], problem: { kind: 'none' } }
            : { tasks: board.tasks, columns: board.columns, problem: null },
        ),
      (err: unknown) => setState((s) => ({ ...s, tasks: s.tasks ?? [], problem: { kind: 'failed', message: errorMessage(err) } })),
    )
  }, [])
  useEffect(retry, [retry])
  const done = useMemo(() => doneOf(state.columns), [state.columns])
  return { ...state, done, retry }
}

// What the list says when it has nothing to offer.
function Note({ tasks, problem, retry, query }: { tasks: readonly Task[] | null; problem: TaskProblem | null; retry?: () => void; query: string }) {
  if (problem?.kind === 'none')
    return (
      <>
        <span>Aucun module de tâches actif : active Notion ou un autre outil de tâches.</span>
        <button type="button" className="btn lunar-btn-sm" onClick={() => navigate('/reglages/extensions')}>
          Réglages › Extensions
        </button>
      </>
    )
  if (problem?.kind === 'failed')
    return (
      <>
        <span>Les tâches n’ont pas pu être lues : {problem.message}</span>
        {retry && (
          <button type="button" className="btn lunar-btn-sm" onClick={retry}>
            Réessayer
          </button>
        )}
      </>
    )
  if (!tasks) return <span className="legend">Lecture des tâches…</span>
  return <span className="muted">{query.trim() ? `Aucune tâche ne correspond à « ${query.trim()} ».` : 'Aucune tâche à choisir.'}</span>
}

type ListProps = TaskSearch & {
  tasks: readonly Task[] | null
  problem?: TaskProblem | null
  retry?: () => void
}

// The search, the result chosen with the arrows, and the list drawn under a field or in the flow.
function useTaskList(props: ListProps, query: string) {
  const id = useId()
  const [active, setActive] = useState(0)
  const results = props.tasks && !props.problem ? findTasks(props.tasks, query, props) : []
  const at = Math.min(active, Math.max(results.length - 1, 0))
  const arrows = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive(Math.min(at + 1, Math.max(results.length - 1, 0)))
    else if (e.key === 'ArrowUp') setActive(Math.max(at - 1, 0))
    else return false
    e.preventDefault()
    return true
  }
  const list = (pick: (task: Task) => void, onDouble?: (task: Task) => void): ReactNode =>
    results.length ? (
      <ul id={`${id}-list`} role="listbox" className="menu lunar-tasks-list" aria-label="Tâches">
        {results.map((t, i) => (
          <li
            key={t.id}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === at}
            className={`menu-item lunar-tasks-item${i === at ? ' active' : ''}${props.done(t) ? ' done' : ''}`}
            // Before the field's blur: the choice is made while the list is still there.
            onMouseDown={(e) => {
              e.preventDefault()
              setActive(i)
              pick(t)
            }}
            onDoubleClick={() => onDouble?.(t)}
            onMouseEnter={() => setActive(i)}
          >
            {t.ref && <span className="card-id">{t.ref}</span>}
            <span className="ellipsis grow lunar-tasks-title">{t.title}</span>
            {props.done(t) && <span className="legend">terminée</span>}
          </li>
        ))}
      </ul>
    ) : (
      <div className="menu lunar-tasks-list lunar-tasks-note" role="status">
        <Note tasks={props.tasks} problem={props.problem ?? null} retry={props.retry} query={query} />
      </div>
    )
  const combobox = {
    role: 'combobox' as const,
    'aria-controls': `${id}-list`,
    'aria-activedescendant': results[at] ? `${id}-${at}` : undefined,
    autoComplete: 'off',
  }
  return { results, at, setActive, arrows, list, combobox }
}

/**
 * A field that finds a task as one types. With `value` (the task chosen, as it is said), it shows it and puts it back
 * when left without a choice (Branches); without, it empties after each choice (Temps). `inline`: the list is always
 * shown, in the flow (a row of the Kanban), and Escape calls `onCancel`. The arrows go through the results, Enter or a
 * click chooses one, Escape closes the list without changing anything.
 */
export function TaskField({
  label,
  hideLabel = false,
  value,
  placeholder = 'Titre, référence ou branche…',
  autoFocus = false,
  inline = false,
  disabled = false,
  onPick,
  onCancel,
  ...search
}: ListProps & {
  label: string
  hideLabel?: boolean
  value?: string
  placeholder?: string
  autoFocus?: boolean
  inline?: boolean
  disabled?: boolean
  onPick: (task: Task) => void
  onCancel?: () => void
}) {
  const [query, setQuery] = useState<string | null>(inline ? '' : null)
  const open = inline || query !== null
  // The chosen task's own words search nothing: the list then offers every task.
  const typed = query === null || query === value ? '' : query
  const { results, at, setActive, arrows, list, combobox } = useTaskList(search, typed)
  const pick = (task: Task) => {
    onPick(task)
    setQuery(inline ? '' : null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      return setQuery(value ?? '')
    }
    if (open && arrows(e)) return
    if (e.key === 'Enter' && open && results[at]) {
      e.preventDefault()
      pick(results[at])
    } else if (e.key === 'Escape' && open) {
      // Only the list closes: not the panel or the dialog around it.
      e.preventDefault()
      e.stopPropagation()
      if (inline) onCancel?.()
      else setQuery(null)
    }
  }
  return (
    <div
      className={`lunar-tasks${inline ? '' : ' floating'}`}
      // The list closes when the focus leaves the field and its list, not when it goes to a button of the list.
      onBlur={(e) => {
        if (!inline && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setQuery(null)
      }}
    >
      <label className="field">
        <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
        <input
          {...combobox}
          aria-expanded={open}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          value={query ?? value ?? ''}
          onFocus={(e) => {
            if (inline) return
            setQuery(value ?? '')
            setActive(0)
            e.currentTarget.select()
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && list(pick)}
    </div>
  )
}

/**
 * The same list in a dialog that confirms (Claude: attaching a session to a task): the arrows or a click choose a
 * task, Enter, a double click or the action's button confirm it, Escape cancels. Resolves to the task, or null.
 */
export function pickTask({ title, action, ...search }: ListProps & { title: string; action: string }): Promise<Task | null> {
  return new Promise((resolve) => {
    openDialog((close) => {
      const answer = (task: Task | null) => {
        close()
        resolve(task)
      }
      return (
        <Modal label={title} onClose={() => answer(null)}>
          <PickTask title={title} action={action} search={search} answer={answer} />
        </Modal>
      )
    })
  })
}

function PickTask({ title, action, search, answer }: { title: string; action: string; search: ListProps; answer: (task: Task | null) => void }) {
  const [query, setQuery] = useState('')
  const { results, at, setActive, arrows, list, combobox } = useTaskList(search, query)
  const chosen = results[at] ?? null
  return (
    <div className="lunar-tasks-pick">
      <h2>{title}</h2>
      <div className="lunar-tasks">
        <label className="field">
          Tâche
          <input
            {...combobox}
            aria-expanded
            placeholder="Titre, référence ou branche…"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (arrows(e)) return
              if (e.key === 'Enter' && chosen) {
                e.preventDefault()
                answer(chosen)
              }
            }}
          />
        </label>
        {list(
          (t) => setActive(results.indexOf(t)),
          (t) => answer(t),
        )}
      </div>
      <div className="row">
        <span className="grow" />
        <button type="button" className="btn" onClick={() => answer(null)}>
          Annuler
        </button>
        <button type="button" className="btn-cta" disabled={!chosen} onClick={() => answer(chosen)}>
          {action}
        </button>
      </div>
    </div>
  )
}
