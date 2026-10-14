import { useEffect, useState } from 'react'
import { saveSettingValues, useSettingValues, type Board } from '@bidule/sdk'
import { board as readBoard } from './api.ts'
import {
  boardColumns,
  choiceOf,
  GROUP_LABELS,
  mergedInto,
  moveName,
  ORDER,
  parseList,
  parseMerges,
  withChoice,
  type StatusChoice,
} from './layout.ts'

const HIDDEN = 'lunar-industries-kanban.hidden'
const MERGE = 'lunar-industries-kanban.statusMerge'

// A choice as the select's value: `shown`, `hidden`, or `merge:<status>`.
const valueOf = (choice: StatusChoice) => (choice.kind === 'merged' ? `merge:${choice.into}` : choice.kind)
const choiceFrom = (value: string): StatusChoice =>
  value.startsWith('merge:') ? { kind: 'merged', into: value.slice('merge:'.length) } : value === 'hidden' ? { kind: 'hidden' } : { kind: 'shown' }

/**
 * Réglages › Kanban: the source's statuses, one row each, in the board's order (dragged, or moved with ↑ ↓), each
 * shown in its own column, hidden, or merged into another column. The order goes in the hidden setting
 * `lunar-industries-kanban.order`, the choice in `hidden` and `statusMerge` (layout.ts: orderColumns, withChoice).
 * Nothing changes in the tools the tasks come from.
 */
export function KanbanSettings() {
  // undefined: not read yet; null: no source of tasks gave a board.
  const [board, setBoard] = useState<Board | null | undefined>(undefined)
  // The row dragged, and the gap it would land in.
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const values = useSettingValues()
  useEffect(() => {
    void readBoard().then(
      (b) => setBoard(b.source === null ? null : b),
      () => setBoard(null),
    )
  }, [])
  if (board === undefined || !values) return null
  const hidden = parseList(values[HIDDEN])
  const merges = parseMerges(values[MERGE])
  const columns = boardColumns(board?.columns ?? [], parseList(values[ORDER]))
  const names = columns.map((c) => c.name)
  // A status hidden before and that the source no longer lists stays there to be shown again.
  const missing = hidden.filter((name) => !names.includes(name))
  // The columns another status can be merged into: those shown in their own column.
  const shown = names.filter((name) => choiceOf(name, hidden, merges).kind === 'shown')

  const choose = (name: string, choice: StatusChoice) => {
    const next = withChoice(name, choice, hidden, merges)
    void saveSettingValues({ [HIDDEN]: JSON.stringify(next.hidden), [MERGE]: JSON.stringify(Object.fromEntries(next.merges)) })
  }
  const move = (name: string, to: number) => void saveSettingValues({ [ORDER]: JSON.stringify(moveName(names, name, to)) })
  const drop = () => {
    if (dragged !== null && dropAt !== null) move(dragged, dropAt)
    setDragged(null)
    setDropAt(null)
  }

  return (
    <div className="fields">
      <div className="field wide">
        Colonnes du Kanban
        {!columns.length && !missing.length && (
          <span className="hint">Aucun statut à organiser : les statuts viennent de la source de tâches, dès qu’elle est configurée.</span>
        )}
        {columns.length > 0 && (
          <span className="hint">
            Dans l’ordre du tableau : glissez une ligne, ou utilisez ↑ ↓, pour la déplacer. Une colonne masquée disparaît du
            tableau avec ses tâches. Une colonne réunie dans une autre n’a plus de colonne à elle : ses tâches s’affichent dans
            l’autre et gardent leur statut dans leur outil, ce qui sert quand deux outils nomment autrement la même étape
            (« En cours/dev » et « En cours »). Rien ne change dans la source des tâches.
          </span>
        )}
        {columns.length > 0 && (
          <ol className="lik-statuses" aria-label="Colonnes du Kanban, dans l’ordre du tableau" onDragLeave={() => setDropAt(null)}>
            {columns.map((c, i) => {
              const choice = choiceOf(c.name, hidden, merges)
              const targets = shown.filter((name) => name !== c.name)
              // A column merged into one that is no longer shown keeps its choice in the list.
              if (choice.kind === 'merged' && !targets.includes(choice.into)) targets.push(choice.into)
              const also = mergedInto(c.name, merges)
              const mark = dropAt === i ? ' drop-before' : dropAt === i + 1 && i === columns.length - 1 ? ' drop-after' : ''
              return (
                <li
                  key={c.name}
                  className={`lik-status${choice.kind !== 'shown' ? ' off' : ''}${dragged === c.name ? ' dragging' : ''}${mark}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', c.name)
                    setDragged(c.name)
                  }}
                  onDragOver={(e) => {
                    if (dragged === null) return
                    e.preventDefault()
                    const box = e.currentTarget.getBoundingClientRect()
                    setDropAt(e.clientY < box.top + box.height / 2 ? i : i + 1)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop()
                  }}
                  onDragEnd={() => {
                    setDragged(null)
                    setDropAt(null)
                  }}
                >
                  <span className="lik-status-grip" aria-hidden="true">
                    ⠿
                  </span>
                  <span className="lik-status-name ellipsis" title={c.name}>
                    {c.name}
                  </span>
                  <span className="legend ellipsis lik-status-info" title={also.length ? `Montre aussi ${also.join(', ')}` : undefined}>
                    {GROUP_LABELS[c.group]}
                    {also.length > 0 && ` · avec ${also.join(', ')}`}
                  </span>
                  <select
                    className="lik-status-choice"
                    aria-label={`${c.name} sur le tableau`}
                    value={valueOf(choice)}
                    onChange={(e) => choose(c.name, choiceFrom(e.target.value))}
                  >
                    <option value="shown">Affichée</option>
                    <option value="hidden">Masquée</option>
                    {targets.map((name) => (
                      <option key={name} value={`merge:${name}`}>
                        Réunie dans « {name} »
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Monter ${c.name}`}
                    title="Monter"
                    disabled={i === 0}
                    onClick={() => move(c.name, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Descendre ${c.name}`}
                    title="Descendre"
                    disabled={i === columns.length - 1}
                    onClick={() => move(c.name, i + 2)}
                  >
                    ↓
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        {missing.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label="Statuts masqués introuvables">
            <span className="legend">Masqués, introuvables dans la source</span>
            {missing.map((name) => (
              <button key={name} type="button" className="chip-btn" title="Ne plus masquer" onClick={() => choose(name, { kind: 'shown' })}>
                {name} ×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
