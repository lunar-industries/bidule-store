import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DaySummary } from '../contract.ts'
import { dayKey, monthStep, monthTitle, parseDay, STATE_DOT, STATE_LABEL } from './format.ts'

export type MonthCursor = { y: number; m: number }

const LETTERS = [
  { short: 'L', name: 'lundi' },
  { short: 'M', name: 'mardi' },
  { short: 'M', name: 'mercredi' },
  { short: 'J', name: 'jeudi' },
  { short: 'V', name: 'vendredi' },
  { short: 'S', name: 'samedi' },
  { short: 'D', name: 'dimanche' },
]

// What the dots say, under the month.
const KEY = [
  { color: STATE_DOT.recorded, text: 'dans le Time Log' },
  { color: STATE_DOT.to_validate, text: 'à valider ou à remplir' },
  { color: STATE_DOT.modified, text: 'modifié, non envoyé' },
  { color: STATE_DOT.absent, text: 'absent' },
]

const inMonth = (key: string, c: MonthCursor) => monthStep(c, parseDay(key)) === 0

const MARGIN = 8

// Taken from quack-board (pages/temps/calendar, Simon's): a month, a dot of each day's state; a click picks the day.
// One stop for Tab, the day shown (else the first of the month); the arrows move day by day and week by week, into the
// next month or the one before; Escape closes it. Changing month by its buttons leaves the focus on the button.
// Drawn in the page's body under its button on the banner's edge (right-aligned with it, kept in the window): an
// ancestor moved by a transform (the banner's edge) would offset it inside it.
export function Calendar({
  anchor,
  cursor,
  onCursor,
  month,
  day,
  today,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null
  cursor: MonthCursor
  onCursor: (c: MonthCursor) => void
  month: DaySummary[]
  day: string
  today: string
  onPick: (day: string) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const own = box.current?.getBoundingClientRect()
    const from = anchor?.getBoundingClientRect()
    if (!own || !from) return
    const left = Math.max(MARGIN, Math.min(from.right - own.width, innerWidth - own.width - MARGIN))
    const below = from.bottom + MARGIN
    const top = below + own.height > innerHeight - MARGIN ? Math.max(MARGIN, from.top - MARGIN - own.height) : below
    setAt({ left, top })
  }, [anchor, cursor])
  // The window resized: the button moved, the calendar would float away from it.
  useEffect(() => {
    addEventListener('resize', onClose)
    return () => removeEventListener('resize', onClose)
  }, [onClose])
  const [focusKey, setFocusKey] = useState(day)
  // The day the arrows went to: it takes the focus once drawn (in a month just turned to, after it renders).
  const goTo = useRef<string | null>(null)
  const first = dayKey(new Date(cursor.y, cursor.m, 1))
  const tabKey = inMonth(focusKey, cursor) ? focusKey : inMonth(day, cursor) ? day : first
  const dayButton = (key: string) => box.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)

  // Opened: the day shown takes the focus, once the calendar is placed (a hidden button cannot take it).
  const opened = useRef(false)
  useEffect(() => {
    if (!at || opened.current) return
    opened.current = true
    dayButton(tabKey)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])
  useEffect(() => {
    if (!goTo.current) return
    dayButton(goTo.current)?.focus()
    goTo.current = null
  })
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target
      if (box.current && target instanceof Element && !box.current.contains(target) && !target.closest('.lit-cal-toggle')) onClose()
    }
    addEventListener('mousedown', away)
    return () => removeEventListener('mousedown', away)
  }, [onClose])

  const states = new Map(month.map((d) => [d.day, d.state]))
  const lead = (new Date(cursor.y, cursor.m, 1).getDay() + 6) % 7
  const count = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells: (string | null)[] = [...Array<null>(lead).fill(null)]
  for (let i = 1; i <= count; i++) cells.push(dayKey(new Date(cursor.y, cursor.m, i)))
  while (cells.length % 7) cells.push(null)
  const shift = (delta: number) => {
    const x = new Date(cursor.y, cursor.m + delta, 1)
    onCursor({ y: x.getFullYear(), m: x.getMonth() })
  }
  const move = (from: string, delta: number) => {
    const d = parseDay(from)
    d.setDate(d.getDate() + delta)
    const key = dayKey(d)
    const step = monthStep(cursor, d)
    if (step) shift(step)
    setFocusKey(key)
    goTo.current = key
  }
  return createPortal(
    <div
      ref={box}
      className="menu floating lit-cal"
      role="dialog"
      aria-label="Calendrier"
      // Measured before it shows: never drawn a frame at the wrong place.
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="row">
        <button type="button" className="btn icon" aria-label="Mois précédent" onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="grow baloo lit-cal-title">{monthTitle(cursor.y, cursor.m)}</span>
        <button type="button" className="btn icon" aria-label="Mois suivant" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="lit-cal-grid" role="grid" aria-label={monthTitle(cursor.y, cursor.m)}>
        <div className="lit-cal-week" role="row">
          {LETTERS.map((l, i) => (
            <span key={i} className="legend lit-cal-letter" role="columnheader" aria-label={l.name}>
              {l.short}
            </span>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, w) => (
          <div key={w} className="lit-cal-week" role="row">
            {cells.slice(w * 7, w * 7 + 7).map((key, i) => {
              if (!key) return <span key={`x${w}-${i}`} role="gridcell" />
              const state = states.get(key) ?? 'empty'
              return (
                <span key={key} role="gridcell">
                  <button
                    type="button"
                    data-day={key}
                    tabIndex={key === tabKey ? 0 : -1}
                    className={`lit-cal-day${key === today ? ' today' : ''}${key > today ? ' future' : ''}`}
                    aria-pressed={key === day}
                    aria-label={`${Number(key.slice(8))}${['empty', 'future', 'off'].includes(state) ? '' : `, ${STATE_LABEL[state]}`}`}
                    onClick={() => onPick(key)}
                    onFocus={() => setFocusKey(key)}
                    onKeyDown={(e) => {
                      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
                      if (step === undefined) return
                      e.preventDefault()
                      move(key, step)
                    }}
                  >
                    {Number(key.slice(8))}
                    <span className="dot lit-cal-dot" style={{ background: STATE_DOT[state] }} />
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <ul className="lit-cal-key" aria-label="Les points de couleur">
        {KEY.map((k) => (
          <li key={k.text}>
            <span className="dot lit-cal-key-dot" style={{ background: k.color }} />
            {k.text}
          </li>
        ))}
      </ul>
    </div>,
    document.body
  )
}
