import { useEffect, useState } from 'react'
import { saveSettingValues, useSettingValues, type Board, type TaskGroup } from '@bidule/sdk'
import { board as readBoard } from './api.ts'
import { GROUP_LABELS, parseList } from './layout.ts'

const HIDDEN = 'lunar-industries-kanban.hidden'
const GROUPS: TaskGroup[] = ['todo', 'doing', 'done']

// Réglages › Lunar Industries - Kanban: the statuses left off the board, chosen among the source's own (the board's
// columns, group by group, as the source gives them), as Workspace's « Statuts masqués sur le Kanban ».
export function KanbanSettings() {
  // undefined: not read yet; null: no source of tasks gave a board.
  const [board, setBoard] = useState<Board | null | undefined>(undefined)
  const values = useSettingValues()
  useEffect(() => {
    void readBoard().then(
      (b) => setBoard(b.source === null ? null : b),
      () => setBoard(null),
    )
  }, [])
  if (board === undefined || !values) return null
  const hidden = parseList(values[HIDDEN])
  const columns = board?.columns ?? []
  // A status hidden before and that the source no longer lists stays there to be shown again.
  const missing = hidden.filter((name) => !columns.some((c) => c.name === name))
  const toggle = (name: string, isHidden: boolean) =>
    void saveSettingValues({ [HIDDEN]: JSON.stringify(isHidden ? hidden.filter((h) => h !== name) : [...hidden, name]) })
  const chip = (name: string, label: string) => {
    const isHidden = hidden.includes(name)
    return (
      <button key={name} type="button" className="chip-btn" aria-pressed={isHidden} onClick={() => toggle(name, isHidden)}>
        {label}
      </button>
    )
  }
  return (
    <div className="fields">
      <div className="field wide">
        Statuts masqués sur le Kanban
        {!columns.length && !missing.length && (
          <span className="hint">Aucun statut à choisir : les statuts viennent de la source de tâches (Notion), dès qu’elle est configurée.</span>
        )}
        {GROUPS.map((group) => {
          const names = columns.filter((c) => c.group === group)
          return names.length ? (
            <div key={group} className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={GROUP_LABELS[group]}>
              <span className="legend">{GROUP_LABELS[group]}</span>
              {names.map((c) => chip(c.name, c.name))}
            </div>
          ) : null
        })}
        {missing.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label="Statuts introuvables">
            <span className="legend">Introuvables</span>
            {missing.map((name) => chip(name, `${name} (introuvable)`))}
          </div>
        )}
        <span className="hint">Leurs colonnes disparaissent du tableau ; rien ne change dans la source des tâches.</span>
      </div>
    </div>
  )
}
