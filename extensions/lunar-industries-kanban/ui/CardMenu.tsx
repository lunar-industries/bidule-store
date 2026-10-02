import { useEffect, useRef } from 'react'
import { react, runOnApi, useCommands, type KanbanParts, type Task } from '@bidule/sdk'
import { errorMessage } from './api.ts'

export type MenuColumn = { name: string; label: string }

// A card's menu (right click, or the menu key on a focused card): opening the task in its source, the extensions'
// actions (start it, a Claude session, a branch, its conversation…), linking branches, then moving it.
export function CardMenu({
  task,
  x,
  y,
  source,
  actions,
  link,
  columns,
  move,
  close,
}: {
  task: Task
  x: number
  y: number
  source: string
  actions: KanbanParts['actions']
  // null without the git role.
  link: (() => void) | null
  columns: MenuColumn[]
  move: (status: string) => void
  close: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector('button')?.focus()
    const away = (e: Event) => e.target instanceof Node && !menu.current?.contains(e.target) && close()
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close()
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const at = items.findIndex((item) => item === document.activeElement)
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
    addEventListener('mousedown', away)
    addEventListener('keydown', keys)
    return () => {
      removeEventListener('mousedown', away)
      removeEventListener('keydown', keys)
    }
  }, [close])
  const run = (fn: () => unknown) => {
    close()
    void Promise.resolve(fn()).catch((err: unknown) => react('panic', errorMessage(err), errorMessage(err)))
  }
  // A command the other modules contribute to the menu: its id is known at run time only, so it is looked up (as `execute`
  // does for a known one) rather than typed.
  const commands = useCommands()
  const runCommand = (id: string, args: unknown) => {
    const command = commands.find((c) => c.id === id)
    return command ? command.run(args) : runOnApi(id, args)
  }
  const url = task.url
  const targets = columns.filter((c) => c.name !== task.status)
  const rows = 1 + actions.length + (link ? 1 : 0) + targets.length
  // Kept inside the window.
  const left = Math.min(x, innerWidth - 280)
  const top = Math.max(8, Math.min(y, innerHeight - rows * 40 - 24))
  return (
    <div ref={menu} className="menu floating lik-menu" role="menu" style={{ left, top }}>
      {url && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => window.open(url, '_blank', 'noopener'))}>
          Ouvrir dans {source}
        </button>
      )}
      {actions.map((a) => (
        <button
          key={a.command}
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => run(() => runCommand(a.command, { taskId: task.id }))}
        >
          {a.title}
        </button>
      ))}
      {link && (
        <button type="button" role="menuitem" className="menu-item" onClick={() => run(link)}>
          Lier des branches…
        </button>
      )}
      {targets.length > 0 && <hr className="menu-sep" />}
      {targets.map((c) => (
        <button key={c.name} type="button" role="menuitem" className="menu-item" onClick={() => run(() => move(c.name))}>
          Déplacer vers {c.label}
        </button>
      ))}
    </div>
  )
}
