import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import type { Task } from '@bidule/sdk'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import type { KanbanBranch } from '../contract.ts'
import { badgeOf, branchLabel, marksOf, noteOf, type Mark, type Tone } from './layout.ts'

// The tags' tones, the same in every Lunar Industries module (lunar-industries-common).
const TONE_CLASS: Record<Tone, string> = {
  ok: 'lunar-tone-ok',
  bad: 'lunar-tone-bad',
  warn: 'lunar-tone-warn',
  info: 'lunar-tone-info',
  neutral: 'lunar-tone-neutral',
  accent: 'lunar-tone-accent',
}

/**
 * A card (maquette « Kanban Lunar », La carte) : its reference (and its tool, when two give tasks), its due date, its
 * title, its branch, then its marks (review, CI), and a note when it says something. One stop
 * of Tab for the whole board: the board gives each card its `tabIndex` and its keys. A click selects it with Ctrl or
 * Shift, a double click opens it in its tool, a right click opens its menu.
 */
export function Card({
  task,
  done,
  today,
  branches,
  tool,
  active,
  selected,
  branchOver,
  cardRef,
  onKeyDown,
  onClick,
  onOpen,
  onMenu,
  onMark,
  drag,
  drop,
}: {
  task: Task
  done: boolean
  today: string
  branches: KanbanBranch[]
  // The tool it comes from, said when two give tasks.
  tool: string | null
  active: boolean
  selected: boolean
  branchOver: boolean
  cardRef: (el: HTMLElement | null) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  onClick: (e: MouseEvent<HTMLElement>) => void
  onOpen: () => void
  onMenu: (e: MouseEvent<HTMLElement>) => void
  onMark: (mark: Mark) => void
  drag: (e: DragEvent<HTMLElement>) => void
  drop: Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>
}) {
  const badge = badgeOf(task, done, today)
  const marks = marksOf(branches)
  const branch = branchLabel(branches)
  const note = noteOf(task, done)
  const late = badge?.tone === 'accent'
  const label = [task.ref, task.title, badge?.text, branch, selected ? 'sélectionnée' : ''].filter(Boolean).join(', ')
  return (
    <article
      ref={cardRef}
      role="listitem"
      className={`lik-card${done ? ' done' : ''}${late ? ' late' : ''}${selected ? ' selected' : ''}${branchOver ? ' branch-over' : ''}`}
      tabIndex={active ? 0 : -1}
      aria-label={label}
      aria-haspopup="menu"
      draggable
      onDragStart={drag}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      {...drop}
    >
      <div className="row lik-card-head">
        {selected && (
          <span className="lik-check-mark" aria-hidden="true">
            <Icon name="check" size={11} />
          </span>
        )}
        {task.ref && <span className="mono lik-ref">{task.ref}</span>}
        {tool && <span className="lik-tool">{tool}</span>}
        <span className="grow" />
        {badge && <span className={`tag ${TONE_CLASS[badge.tone]}`}>{badge.text}</span>}
      </div>
      <div className="card-title">{task.title}</div>
      {branch && (
        <span className="mono lik-branch ellipsis" title={branches.map((b) => `${b.repoLabel} · ${b.name}`).join('\n')}>
          {branch}
        </span>
      )}
      {branchOver && <div className="lik-link-hint">Lâche pour lier la branche à cette tâche</div>}
      {marks.length > 0 && (
        <div className="row lik-marks">
          {marks.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`tag lik-mark ${TONE_CLASS[m.tone]}`}
              title={m.tip}
              onClick={(e) => {
                e.stopPropagation()
                onMark(m)
              }}
            >
              {m.text}
            </button>
          ))}
        </div>
      )}
      {note && <div className="lik-note">{note}</div>}
    </article>
  )
}
