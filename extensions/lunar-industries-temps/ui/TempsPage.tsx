import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import {
  BannerTools,
  busy,
  errorMessage,
  navigate,
  react,
  useFocusMode,
  useHint,
  useMascotClearance,
  useOn,
  type Task,
} from '@bidule/sdk'
import { confirm, type Ask } from '@bidule/ext-lunar-industries-common/ui/confirm'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import { useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import { Alert, Empty, Loading } from '@bidule/ext-lunar-industries-common/ui/states'
import { doneOf, TaskField, type TaskProblem } from '@bidule/ext-lunar-industries-common/ui/tasks'
import type { DayLine, DayState, DaySummary, DayView, LineInput, Props, Summary } from '../contract.ts'
import { api, board as readBoard, moveTask, type Board } from './api.ts'
import { Calendar, type MonthCursor } from './Calendar.tsx'
import { latestOf } from './latest.ts'
import {
  addDays,
  bshort,
  DAY_SHARES,
  DAYS_SHORT,
  dayCalled,
  dayKey,
  dayName,
  dayTitle,
  fmtShare,
  hm,
  isoWeekday,
  kindLabel,
  labelColor,
  monday,
  parseDay,
  PENDING,
  previousWorkDay,
  sentAtText,
  shift,
  STATE_DOT,
  STATE_LABEL,
  weekNumber,
  weekRange,
  workText,
} from './format.ts'
import './temps.css'

// Kept while the app runs: coming back the same date, the page shows the day chosen again.
let chosen: { on: string; day: string } | null = null
const days = new Map<string, DayView>()

// How long the draft waits after the last change before it is saved.
const SAVE_DELAY = 600

// A line as edited on the page, before it is saved.
type Line = Pick<
  DayLine,
  'taskId' | 'taskTitle' | 'taskRef' | 'label' | 'share' | 'confirmed' | 'repo' | 'branch' | 'props' | 'tiny' | 'reason' | 'url'
> & {
  // The saved line it comes from (settling an orphan goes through it), null for a new one.
  id: string | null
  key: string
}

const lineKey = (l: Pick<Line, 'taskId' | 'repo' | 'branch' | 'label'>) =>
  l.taskId ? `t:${l.taskId}` : l.repo && l.branch ? `b:${l.repo}\u0000${l.branch}` : `none:${l.label}`
// A line's identity on the page: saving changes its id, and a task can have one line per label.
const lineId = (l: Pick<Line, 'key' | 'label'>) => `${l.key}\u0000${l.label}`

const linesOf = (view: DayView | null): Line[] =>
  (view?.lines ?? []).map((l) => ({
    id: l.id,
    key: l.key,
    taskId: l.taskId,
    taskTitle: l.taskTitle,
    taskRef: l.taskRef,
    label: l.label,
    share: l.share,
    confirmed: l.confirmed,
    repo: l.repo,
    branch: l.branch,
    props: l.props,
    tiny: l.tiny,
    reason: l.reason,
    url: l.url,
  }))

// The day as the API gives it, its lines in the order the page shows them (the API sorts them by share); new lines
// come last.
function inPageOrder(data: DayView, shown: Pick<Line, 'key' | 'label'>[]): DayView {
  const order = shown.map(lineId)
  const rank = (l: Pick<Line, 'key' | 'label'>) => {
    const i = order.indexOf(lineId(l))
    return i < 0 ? order.length : i
  }
  return { ...data, lines: [...data.lines].sort((a, b) => rank(a) - rank(b)) }
}

// A segment's label colour, as the CSS variable its style sheet mixes with the card.
const tint = (color: string): Record<string, string> => ({ '--c': color })

const fail = (err: unknown) => react('panic', errorMessage(err), errorMessage(err))

const EDITABLE: DayState[] = ['to_validate', 'modified', 'empty', 'to_fill', 'off']

// A day without lines: what it means (its title, its sentence), and what can be done about it.
const EMPTY_DAY: Partial<Record<DayState, [string, string]>> & { empty: [string, string] } = {
  to_fill: [
    'Jour de travail sans activité',
    'Un jour de travail passé doit figurer dans le Time Log : ajoute une ligne (réunion, veille…) ou marque une absence.',
  ],
  off: ['Jour non travaillé', "D'après tes réglages, rien n'est attendu ce jour-là."],
  absent: ['Absent ce jour-là', 'La journée est notée comme absence dans le Time Log.'],
  future: ["Ce jour n'est pas encore passé", 'Il sera proposé une fois passé.'],
  empty: ["Aucune activité pour l'instant", 'La journée se remplira avec tes commits et tes changements de statut.'],
}

// Asks before an action that replaces what the user changed by hand (the common confirmation, the focus on « Annuler »:
// something is lost); runs it at once when there is nothing to lose.
async function confirmFirst(ask: boolean, question: Omit<Ask, 'danger'>, run: () => void) {
  if (!ask || (await confirm({ ...question, danger: true }))) run()
}

// Taken from quack-board (pages/temps, Simon's): the week on the left, the chosen day on the right, shared out in
// twentieths of a day between its lines, then sent to the Time Log.
export function TempsPage() {
  const today = dayKey(new Date())
  const returning = chosen?.on === today
  const [day, setDay] = useState(() => (returning && chosen?.day) || today)
  const [view, setView] = useState<DayView | null>(() => days.get(day) ?? null)
  const [dayError, setDayError] = useState<string | null>(null)
  // The week as read, with the Monday it was read for: another Monday means the week shown is still being read.
  const [week, setWeek] = useState<{ monday: string; days: DaySummary[] } | null>(null)
  const [weekError, setWeekError] = useState<string | null>(null)
  const [cal, setCal] = useState<MonthCursor | null>(null)
  const [month, setMonth] = useState<DaySummary[]>([])
  const [taskBoard, setBoard] = useState<Board | null>(null)
  const [tasksProblem, setTasksProblem] = useState<TaskProblem | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [edits, setEdits] = useState<Line[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(false)
  const [savedDay, setSavedDay] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, openMenu] = useMenu()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editsRef = useRef<Line[] | null>(null)
  const viewRef = useRef<DayView | null>(view)
  const dayRef = useRef(day)
  const workingRef = useRef(false)
  const savingRef = useRef(false)
  const bar = useRef<HTMLDivElement>(null)
  const calToggle = useRef<HTMLButtonElement>(null)
  const foot = useRef<HTMLElement>(null)
  const drag = useRef<{ x0: number; width: number; scale: number; from: Line[]; left: number; right: number | null } | null>(null)

  useEffect(() => {
    chosen = { on: today, day }
    dayRef.current = day
  }, [today, day])
  const show = useCallback((v: DayView) => {
    days.set(v.day, v)
    viewRef.current = v
    setView(v)
  }, [])
  const setLines = (lines: Line[] | null) => {
    editsRef.current = lines
    setEdits(lines)
  }

  // ---------- reading

  const weekKey = dayKey(monday(parseDay(day)))
  const loadWeek = useCallback(() => {
    void api.week(weekKey).then(
      (list) => {
        setWeek({ monday: weekKey, days: list })
        setWeekError(null)
      },
      (err: unknown) => setWeekError(errorMessage(err))
    )
  }, [weekKey])
  const loadSummary = useCallback(() => void api.summary().then(setSummary, () => undefined), [])
  // The day shown, read again: what was read before stays in view if it fails.
  const loadDay = useCallback(
    (key: string) =>
      api.day(key).then(
        (v) => {
          if (dayRef.current !== key) return
          setDayError(null)
          show(v)
        },
        (err: unknown) => dayRef.current === key && setDayError(errorMessage(err))
      ),
    [show]
  )
  useEffect(() => {
    setSelected(null)
    setLines(null)
    setDayError(null)
    // A day already read shows at once, while it is read again; another shows « Lecture de la journée… ».
    const cached = days.get(day) ?? null
    viewRef.current = cached
    setView(cached)
    void loadDay(day)
  }, [day, loadDay])
  useEffect(loadWeek, [loadWeek])
  useEffect(() => {
    if (cal) void api.month(cal.y, cal.m).then(setMonth, fail)
  }, [cal])
  // Read again at each change the core announces: only the last reading asked is kept.
  const [readLatest] = useState(() => latestOf(readBoard))
  const loadBoard = useCallback(
    () =>
      void readLatest().then(
        (b) => {
          setBoard(b)
          setTasksProblem(b ? null : { kind: 'none' })
        },
        (err: unknown) => setTasksProblem({ kind: 'failed', message: errorMessage(err) })
      ),
    [readLatest]
  )
  useEffect(() => {
    loadBoard()
    loadSummary()
  }, [loadBoard, loadSummary])
  useOn('objects.changed', ({ type }) => type === 'task' && loadBoard())

  // In the morning, before any activity, the previous work day still to deal with comes first (once a date), and the
  // page says it opened it.
  const decided = useRef(returning)
  useEffect(() => {
    if (decided.current || !summary) return
    decided.current = true
    if (summary.todayState !== 'empty' && summary.todayState !== 'off') return
    const key = previousWorkDay(today, summary.workDays)
    if (!key) return
    void api.week(key).then((list) => {
      const state = list.find((x) => x.day === key)?.state
      if ((state !== 'to_validate' && state !== 'to_fill') || dayRef.current !== today) return
      go(key)
      react('quack', `${dayCalled(key, today)} n'est pas encore ${state === 'to_fill' ? 'rempli' : 'validé'}, je te l'ai ouvert.`)
    }, fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary])

  // ---------- saving the draft

  // Saves the edits waiting, whatever the day's total: only sending needs 1. What the API answers replaces the
  // page's copy unless the user changed something meanwhile (saved in turn).
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setPending(false)
    const lines = editsRef.current
    const shown = viewRef.current
    if (!lines || !shown) return
    const d = shown.day
    savingRef.current = true
    setSaving(true)
    try {
      const data = await api.replace(
        d,
        lines.map(
          (l): LineInput => ({
            taskId: l.taskId,
            label: l.label,
            share: l.share,
            confirmed: l.confirmed,
            repo: l.repo,
            branch: l.branch,
            props: l.props,
          })
        )
      )
      setSavedDay(d)
      days.set(d, data)
      loadWeek()
      loadSummary()
      if (d !== dayRef.current || editsRef.current !== lines) return
      show(inPageOrder(data, lines))
      setLines(null)
    } catch (err) {
      fail(err)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [loadWeek, loadSummary, show])
  // Leaving the page saves what is still waiting.
  useEffect(() => () => void flush(), [flush])

  const queueSave = () => {
    if (timer.current) clearTimeout(timer.current)
    setPending(true)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY)
  }
  const dropPending = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setPending(false)
    setLines(null)
  }

  // Changing day saves the draft of the one left first.
  const go = (key: string) => {
    if (key === dayRef.current) return
    void flush()
    setDay(key)
  }

  // ---------- what is shown

  const shownDay = view?.day ?? day
  const state: DayState = view?.state ?? 'empty'
  const editable = Boolean(view) && EDITABLE.includes(state)
  const recorded = state === 'recorded' || state === 'absent'
  const lines = edits ?? linesOf(view)
  const showLines = lines.length > 0 && state !== 'absent'
  const total = lines.reduce((a, l) => a + l.share, 0)
  // A git branch linked to no task is often a forgotten task: it must be attached or kept on purpose.
  const orphans = lines.filter((l) => !l.taskId && l.branch && !l.confirmed)
  const canSend = lines.length > 0 && total === DAY_SHARES && !orphans.length && !working && !view?.logProblem
  const tasks: Task[] = taskBoard?.tasks ?? []
  const columns = taskBoard?.columns ?? []
  const done = useMemo(() => doneOf(columns), [columns])
  // What the task fields offer: null while the tasks are read.
  const offered = taskBoard || tasksProblem ? tasks : null
  const labels = view?.labels ?? []
  const extras = view?.extras ?? []
  const workDays = summary?.workDays ?? [1, 2, 3, 4, 5]
  const isWorkDay = (key: string) => workDays.includes(isoWeekday(key))
  const offWithActivity = showLines && !isWorkDay(shownDay)
  const editing = () => Boolean(editsRef.current || timer.current || savingRef.current || workingRef.current)
  // What the user changed by hand on this day: an action that replaces the draft asks first.
  const handMade = Boolean(edits) || Boolean(view?.edited)
  const sendBar = editable && showLines
  const focus = useFocusMode()

  // In focus mode the mascot's disc sits at the bottom right: it stays above the send bar.
  const [footHeight, setFootHeight] = useState(0)
  const hasFoot = sendBar || recorded
  useEffect(() => {
    const el = foot.current
    if (!el) return setFootHeight(0)
    const measure = () => setFootHeight(el.offsetHeight)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [hasFoot])
  useMascotClearance(focus && hasFoot ? footHeight : 0)

  // The API announced a change of the days (new activity, the Time Log read again): the lists are read again, and the
  // day shown too, unless the user is changing it.
  useOn('lunar-industries-temps.changed', () => {
    loadWeek()
    loadSummary()
    if (cal) void api.month(cal.y, cal.m).then(setMonth, () => undefined)
    if (editing()) return
    const d = viewRef.current?.day ?? dayRef.current
    api.day(d).then(
      (data) => {
        if (d !== dayRef.current || editing()) return
        show(inPageOrder(data, linesOf(viewRef.current)))
      },
      () => undefined
    )
  })

  const checks = [
    {
      ok: total === DAY_SHARES,
      text:
        total === DAY_SHARES
          ? 'La journée fait 1 j.'
          : total < DAY_SHARES
            ? `Il reste ${fmtShare(DAY_SHARES - total)} j à répartir (${fmtShare(total)} j sur 1).`
            : `La journée dépasse 1 j de ${fmtShare(total - DAY_SHARES)} j.`,
    },
    {
      ok: !orphans.length,
      text: orphans.length
        ? `${orphans.length} branche${orphans.length > 1 ? 's' : ''} sans tâche à rattacher ou à garder.`
        : 'Chaque ligne a sa tâche ou est gardée sans tâche.',
    },
  ]
  const draftNote = saving || pending ? 'Enregistrement…' : savedDay === shownDay ? 'Brouillon enregistré' : ''

  // Each line with what the page shows about it.
  const rows = useMemo(() => {
    const signals = view?.signals ?? []
    const startColumn = columns.find((c) => c.group === 'doing') ?? null
    return lines.map((l, index) => {
      const t = tasks.find((x) => x.id === l.taskId)
      const evidence = signals.filter((s) => s.key === l.key)
      const branch = l.branch ?? evidence.find((s) => s.branch)?.branch ?? null
      const where = branch ? bshort(branch) : null
      const orphan = !l.taskId && Boolean(l.branch) && !l.confirmed
      // The API names every task, the user's or not; the board, a task just added.
      const title = l.taskTitle ?? t?.title ?? (l.taskId ? 'Tâche inconnue' : l.label)
      const toDo = t ? columns.find((c) => c.name === t.status)?.group === 'todo' : false
      return {
        ...l,
        index,
        rowId: lineId(l),
        color: orphan ? 'var(--bad-dot)' : labelColor(l.label, labels),
        title,
        ref: l.taskRef ?? t?.ref ?? null,
        // A line without a task is named by its label; an orphan branch by its branch, until settled.
        name: orphan && where ? where : title,
        where,
        orphan,
        kept: !l.taskId && Boolean(l.branch) && l.confirmed,
        // Commits on a task the source still lists as to do (today's, or those of the last weeks): the status was probably
        // forgotten.
        start: toDo && (evidence.some((s) => s.kind === 'commit') || (l.taskId !== null && (view?.started.includes(l.taskId) ?? false))) ? startColumn : null,
        evidence: evidence.map((s) => ({ time: hm(s.minute), kind: kindLabel(s.kind), detail: s.detail })),
      }
    })
  }, [lines, view, tasks, columns, labels])

  // A day over 1 widens the scale so every segment still fits in the bar.
  const scale = Math.max(DAY_SHARES, total)
  const segments = useMemo(() => {
    const shown = rows.filter((r) => r.share > 0)
    let at = 0
    return shown.map((row, k) => {
      const left = (at / scale) * 100
      at += row.share
      return { row, next: shown[k + 1] ?? null, left, width: (row.share / scale) * 100, size: row.share >= 4 ? 'lg' : row.share >= 2 ? 'md' : 'sm' }
    })
  }, [rows, scale])
  const rest = editable && total < DAY_SHARES
    ? { left: (total / DAY_SHARES) * 100, width: ((DAY_SHARES - total) / DAY_SHARES) * 100, text: DAY_SHARES - total >= 2 ? `${fmtShare(DAY_SHARES - total)} à répartir` : '' }
    : null

  const weekStart = monday(parseDay(day))
  const weekLoading = week?.monday !== weekKey
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i)
    const key = dayKey(d)
    const found = weekLoading ? undefined : week?.days.find((x) => x.day === key)
    const st = found?.state ?? 'empty'
    const isToday = key === today
    return {
      key,
      state: st,
      label: `${DAYS_SHORT[i]} ${d.getDate()}`,
      isToday,
      aria: `${dayName(key)}${isToday ? ", aujourd'hui" : ''}, ${weekLoading ? 'en lecture' : STATE_LABEL[st]}`,
      stateText: weekLoading ? '…' : STATE_LABEL[st],
      hollow: weekLoading || st === 'empty' || st === 'future',
      off: !isWorkDay(key),
      total: weekLoading ? '' : st === 'absent' ? '—' : found?.total ? `${fmtShare(found.total)} j` : '',
    }
  })
  const weekPending = weekLoading ? [] : weekDays.filter((d) => PENDING.includes(d.state))
  const nextDay = weekPending.find((d) => d.key !== shownDay) ?? null

  // What the mascot says about this day.
  const hints: Record<DayState, string> = {
    future: "Ce jour n'est pas encore arrivé. Coin.",
    empty: 'Rien dans git ni dans tes tâches pour l’instant.',
    to_fill: 'Un jour de travail sans rien dans git ni dans tes tâches. Réunions ? Absence ?',
    off: 'Jour non travaillé. Repos !',
    recorded: shownDay === today ? 'Journée dans le Time Log. Je fais une sieste.' : 'Cette journée est déjà dans le Time Log.',
    absent: 'Journée d’absence, bien notée dans le Time Log.',
    modified: 'Tu modifies une journée déjà envoyée : renvoie-la quand c’est bon.',
    to_validate: orphans.length
      ? "Des commits sur une branche sans tâche… c'était pour quoi ?"
      : `J'ai réparti ${shownDay === today ? 'ta journée' : 'cette journée'} d'après git et tes tâches. Tu valides ?`,
  }
  useHint(dayError ? "Je n'arrive pas à lire cette journée." : view ? hints[state] : null, state === 'recorded' && !dayError ? 'sleep' : 'listen')

  // ---------- editing

  const edit = (change: (lines: Line[]) => Line[]) => {
    setLines(change(lines.map((l) => ({ ...l }))))
    queueSave()
  }
  // − and + on a line: a twentieth of a day less or more, between 0 and the whole day.
  const step = (index: number, delta: number) =>
    edit((ls) => {
      ls[index].share = Math.min(DAY_SHARES, Math.max(0, ls[index].share + delta))
      return ls
    })
  const setShares = (from: Line[], left: number, right: number | null, delta: number) => {
    const next = shift(
      from.map((l) => l.share),
      left,
      right,
      delta
    )
    if (next) setLines(from.map((l, i) => ({ ...l, share: next[i] })))
  }
  const grab = (e: PointerEvent<HTMLSpanElement>, left: number, right: number | null) => {
    if (e.button !== 0 || !bar.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x0: e.clientX, width: bar.current.getBoundingClientRect().width, scale, from: lines, left, right }
  }
  // Each move is counted from where the grip was taken: back there (no change), the shares are those of the start
  // again, not the last ones drawn.
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (!d) return
    const start = d.from.map((l) => l.share)
    const next = shift(start, d.left, d.right, Math.round(((e.clientX - d.x0) / d.width) * d.scale)) ?? start
    if (next.every((s, i) => lines[i]?.share === s)) return
    setLines(d.from.map((l, i) => ({ ...l, share: next[i] })))
  }
  // A drag saves once, when the grip is released.
  const drop = () => {
    if (!drag.current) return
    drag.current = null
    if (editsRef.current) queueSave()
  }
  const nudge = (e: KeyboardEvent, left: number, right: number | null, delta: number) => {
    e.preventDefault()
    setShares(lines, left, right, delta)
    queueSave()
  }
  const setLabel = (index: number, label: string) => {
    const before = lineId(lines[index])
    const next = lines.map((l) => ({ ...l }))
    next[index].label = label
    next[index].key = lineKey(next[index])
    setLines(next)
    queueSave()
    // The open line stays open under its new identity.
    if (selected === before) setSelected(lineId(next[index]))
  }
  const setProp = (index: number, name: string, value: Props[string]) =>
    edit((ls) => {
      ls[index].props = { ...ls[index].props, [name]: value }
      return ls
    })
  const remove = (index: number) => {
    if (selected === lineId(lines[index])) setSelected(null)
    edit((ls) => ls.filter((_, i) => i !== index))
  }
  // A new line, with a task or without (a meeting, a deployment…), at 0 until given a share.
  const add = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId)
    const line: Line = {
      id: null,
      key: '',
      taskId: taskId || null,
      taskTitle: task?.title ?? null,
      taskRef: task?.ref ?? null,
      label: view?.defaultLabel ?? labels[0] ?? '',
      share: 0,
      confirmed: true,
      repo: null,
      branch: null,
      props: {},
      tiny: false,
      reason: '',
      url: null,
    }
    line.key = lineKey(line)
    edit((ls) => [...ls, line])
    setSelected(lineId(line))
  }

  const run = async (action: () => Promise<unknown>) => {
    workingRef.current = true
    setWorking(true)
    try {
      await busy(action())
    } catch (err) {
      fail(err)
    } finally {
      workingRef.current = false
      setWorking(false)
    }
  }
  // The actions below replace the draft: what waits to be saved is dropped.
  const act = (call: (d: string) => Promise<DayView>, after?: () => void) => {
    dropPending()
    void run(async () => {
      show(await call(shownDay))
      loadWeek()
      loadSummary()
      after?.()
    })
  }
  const name = dayName(shownDay)
  const markAbsent = () =>
    void confirmFirst(
      handMade,
      {
        title: `Marquer le ${name} absent ?`,
        text: 'Une seule ligne d’absence remplace tes changements faits à la main sur cette journée.',
        action: 'Marquer absent',
      },
      () => act(api.absent, () => react('quack', `Le ${name} est marqué absent : envoie-le au Time Log quand c’est bon.`))
    )
  const recompute = () =>
    void confirmFirst(
      handMade,
      {
        title: `Recalculer le ${name} ?`,
        text: 'La journée est refaite depuis git et tes tâches : tes changements faits à la main sont perdus.',
        action: 'Recalculer',
      },
      () => act(api.recompute, () => react('quack', "J'ai tout recalculé depuis git et tes tâches."))
    )
  const discard = () =>
    void confirmFirst(
      true,
      { title: `Abandonner les modifications du ${name} ?`, text: 'La journée revient à ce que le Time Log en a.', action: 'Abandonner' },
      () => act(api.discard)
    )
  // Read now, keeping the draft: what waits is saved first.
  const reread = () =>
    void (async () => {
      await flush()
      await run(async () => {
        show(await api.reread(shownDay))
        loadWeek()
        loadSummary()
        react('quack', "J'ai relu le Time Log.")
      })
    })()
  const moreEntries = (): MenuEntry[] => [
    { label: 'Relire le Time Log', run: reread },
    { label: 'Marquer absent…', run: markAbsent, disabled: state === 'absent' },
    { label: 'Recalculer depuis git et les tâches…', run: recompute },
    'separator',
    state === 'modified' && { label: 'Abandonner les modifications…', run: discard },
  ]

  // Settles a line without a task: attached (which links its branch), or kept as such.
  const resolve = async (index: number, change: { taskId?: string; confirmed?: boolean }) => {
    const line = lines[index]
    await flush()
    // After a save the ids change: the line is found again by its branch.
    const saved = viewRef.current?.lines.find((l) => l.key === line.key)
    if (!saved) return
    await run(async () => {
      show(await api.resolve(shownDay, saved.id, change))
      loadWeek()
      if (change.taskId) {
        const task = tasks.find((t) => t.id === change.taskId)
        react('quack', `Coin ! Cette branche va sur ${task?.title ?? 'la tâche'}.`)
      }
    })
  }
  // Nothing is written to the source until the user asks.
  const startTask = (taskId: string, status: string) =>
    void run(async () => {
      await moveTask(taskId, status)
      loadBoard()
      react('quack', `${tasks.find((t) => t.id === taskId)?.title ?? 'La tâche'} passe en ${status}, coin !`)
    })
  const startButton = (taskId: string, column: string) => (
    <button type="button" className="btn lit-started" disabled={working} onClick={() => startTask(taskId, column)}>
      Encore « à faire » malgré des commits : passer en {column}
    </button>
  )
  const send = async () => {
    const n = lines.filter((l) => l.share > 0).length
    const yes = await confirm({
      title: 'Envoyer la journée au Time Log ?',
      text: `${n} ligne${n > 1 ? 's' : ''} ${n > 1 ? 'seront écrites' : 'sera écrite'} dans le Time Log ; les lignes de ce jour qui n'y sont plus seront retirées.`,
      action: 'Envoyer',
    })
    if (!yes) return
    await flush()
    await run(async () => {
      show(await api.send(shownDay))
      loadWeek()
      loadSummary()
      react('quack', 'Coin coin ! Tout est parti dans le Time Log.', 'Journée envoyée dans le Time Log')
    })
  }

  const valueOf = (props: Props, name: string) => {
    const v = props[name]
    return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v)
  }
  const closeCalendar = () => {
    setCal(null)
    calToggle.current?.focus()
  }

  // A task search, with the choice of no task next to it.
  const addRow = (className: string): ReactNode => (
    <div className={`row lit-attach ${className}`}>
      <TaskField
        label="Chercher une tâche à ajouter"
        placeholder="Titre ou référence…"
        tasks={offered}
        done={done}
        problem={tasksProblem}
        retry={loadBoard}
        onPick={(t) => add(t.id)}
      />
      <button type="button" className="btn" onClick={() => add('')}>
        Sans tâche
      </button>
    </div>
  )

  return (
    <div className="page with-tools lit-temps">
      {menu}
      {/* On the banner's edge: back to today, and the calendar, which hangs under its button. */}
      <BannerTools>
        <button type="button" className="banner-button" onClick={() => go(today)}>
          Aujourd'hui
        </button>
        <button
          ref={calToggle}
          type="button"
          className="banner-button lit-cal-toggle"
          aria-expanded={cal !== null}
          aria-haspopup="dialog"
          onClick={() => {
            const d = parseDay(day)
            setCal((c) => (c ? null : { y: d.getFullYear(), m: d.getMonth() }))
          }}
        >
          Calendrier
        </button>
        <button type="button" className="banner-button" title="Réglages de Temps" onClick={() => navigate('/reglages/lunar-industries-temps')}>
          Réglages
        </button>
      </BannerTools>
      {cal && (
        <Calendar
          anchor={calToggle.current}
          cursor={cal}
          onCursor={setCal}
          month={month}
          day={day}
          today={today}
          onPick={(key) => {
            go(key)
            closeCalendar()
          }}
          onClose={closeCalendar}
        />
      )}
      {/* The week on the left, the chosen day on the right. */}
      <section className="panel lit-week" aria-label="Choisir un jour" aria-busy={weekLoading}>
        <div className="row lit-week-head">
          <button type="button" className="btn icon" aria-label="Semaine précédente" onClick={() => go(dayKey(addDays(parseDay(day), -7)))}>
            <Icon name="left" />
          </button>
          <div className="lit-week-title">
            <div className="baloo lit-week-name">Semaine {weekNumber(weekStart)}</div>
            <div className="legend">{weekRange(weekStart)}</div>
          </div>
          <button type="button" className="btn icon" aria-label="Semaine suivante" onClick={() => go(dayKey(addDays(parseDay(day), 7)))}>
            <Icon name="right" />
          </button>
        </div>
        {weekError ? (
          <Alert retry={loadWeek}>La semaine n’a pas pu être lue : {weekError}</Alert>
        ) : (
          weekLoading && <Loading>Lecture de la semaine…</Loading>
        )}
        {/* One stop for Tab, the arrows go to the previous or next day and show it. */}
        <div
          className="lit-week-days"
          role="listbox"
          aria-label="Jours de la semaine"
          tabIndex={0}
          aria-activedescendant={`lit-day-${day}`}
          onKeyDown={(e) => {
            const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
            if (!delta) return
            e.preventDefault()
            go(dayKey(addDays(parseDay(day), delta)))
          }}
        >
          {weekDays.map((d) => (
            <div
              key={d.key}
              id={`lit-day-${d.key}`}
              role="option"
              aria-selected={d.key === day}
              aria-label={d.aria}
              className={`lit-week-day${d.isToday ? ' today' : ''}${d.off ? ' off' : ''}`}
              onClick={() => go(d.key)}
            >
              <span className={`dot lit-week-dot${d.hollow ? ' hollow' : ''}`} style={{ background: d.hollow ? 'transparent' : STATE_DOT[d.state] }} />
              <span className="lit-week-day-name">
                {d.label}
                {d.isToday && <span className="lit-week-day-today"> · aujourd'hui</span>}
              </span>
              <span className="lit-week-day-state">{d.stateText}</span>
              <span className={`baloo lit-week-day-total${d.state === 'recorded' ? ' recorded' : ''}`}>{d.total}</span>
            </div>
          ))}
        </div>
        <p className="legend lit-week-work">
          Jours de travail : <span className="lit-nowrap">{workText(workDays)}</span>
        </p>
        {weekPending.length > 0 && (
          <div className="lit-week-pending">
            <span className="lit-week-pending-text">
              {weekPending.length} journée{weekPending.length > 1 ? 's' : ''} à valider ou à remplir cette semaine
            </span>
            <button type="button" className="btn" onClick={() => go(weekPending[0].key)}>
              Ouvrir la plus ancienne
            </button>
          </div>
        )}
      </section>

      <section className="panel lit-day" aria-labelledby="lit-day-title" aria-busy={!view && !dayError}>
        <div className="row lit-day-head">
          <h2 id="lit-day-title" className="baloo lit-day-title">
            {dayTitle(shownDay)}
          </h2>
          {view && <span className={`tag lunar-tone-${recorded ? 'ok' : PENDING.includes(state) ? 'warn' : 'neutral'}`}>{STATE_LABEL[state]}</span>}
          {offWithActivity && <span className="legend">Jour non travaillé d'après tes réglages, mais il y a eu de l'activité.</span>}
          <span className="grow" />
          {editable && (
            <button
              type="button"
              className="btn icon"
              aria-label="Autres actions sur ce jour"
              aria-haspopup="menu"
              disabled={working}
              onClick={(e) => openMenu(e.currentTarget, moreEntries(), 'Autres actions sur ce jour')}
            >
              <Icon name="more" />
            </button>
          )}
        </div>

        {dayError && (
          <Alert retry={() => void loadDay(day)}>
            La journée n’a pas pu être lue : {dayError}
            {view ? ' Ce qui suit est la dernière lecture de cette journée.' : ''}
          </Alert>
        )}
        {!view && !dayError && <Loading lines={4}>Lecture de la journée…</Loading>}

        {view?.logProblem && editable && <p className="lit-problem">{view.logProblem}</p>}

        {showLines ? (
          <>
            {editable && (
              <p className="legend lit-day-legend">
                Tire une frontière de la barre pour passer du temps d'une ligne à sa voisine, ou choisis la part de chaque ligne dans sa liste.
              </p>
            )}
            <div className="lit-bar-wrap">
              <div className="lit-bar" ref={bar}>
                {rest && (
                  <span className="lit-rest" style={{ left: `${rest.left}%`, width: `${rest.width}%` }}>
                    {rest.text}
                  </span>
                )}
                {segments.map((s) => (
                  <span key={s.row.rowId}>
                    <button
                      type="button"
                      className={`lit-seg${s.row.orphan ? ' orphan' : ''}`}
                      data-size={s.size}
                      style={{ left: `${s.left}%`, width: `${s.width}%`, ...tint(s.row.color) }}
                      title={`${s.row.name} · ${s.row.label} · ${fmtShare(s.row.share)} j`}
                      aria-label={`${s.row.name}, ${s.row.label}, ${fmtShare(s.row.share)} j`}
                      aria-pressed={selected === s.row.rowId}
                      onClick={() => setSelected((x) => (x === s.row.rowId ? null : s.row.rowId))}
                    >
                      {s.size === 'lg' && <span className={`ellipsis lit-seg-title${s.row.orphan ? ' mono' : ''}`}>{s.row.name}</span>}
                      {s.size !== 'sm' && <span className="baloo lit-seg-share">{fmtShare(s.row.share)}</span>}
                    </button>
                    {editable && (
                      // After the last segment, the grip moves the end of the day's filled part.
                      <span
                        className="lit-grip"
                        role="separator"
                        tabIndex={0}
                        aria-orientation="vertical"
                        aria-valuemin={1}
                        aria-label={s.next ? `Frontière entre ${s.row.name} et ${s.next.name}` : `Fin de ${s.row.name}`}
                        aria-valuenow={s.row.share}
                        aria-valuetext={`${fmtShare(s.row.share)} j`}
                        style={{ left: `${s.left + s.width}%` }}
                        onPointerDown={(e) => grab(e, s.row.index, s.next?.index ?? null)}
                        onPointerMove={move}
                        onPointerUp={drop}
                        onPointerCancel={drop}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowLeft') nudge(e, s.row.index, s.next?.index ?? null, -1)
                          if (e.key === 'ArrowRight') nudge(e, s.row.index, s.next?.index ?? null, 1)
                        }}
                      />
                    )}
                  </span>
                ))}
              </div>
              <div className="legend lit-scale" aria-hidden="true">
                <span>0</span>
                <span>0,25</span>
                <span>0,5</span>
                <span>0,75</span>
                <span>1 j</span>
              </div>
            </div>

            {/* The bar's key: one row per line, in the bar's order; one line open at a time. */}
            <ul className="lit-lines">
              {rows.map((r) => {
                const open = selected === r.rowId
                return (
                  <li key={r.rowId} className={`lit-line${r.share ? '' : ' zero'}${open ? ' open' : ''}`}>
                    <div className="lit-line-row">
                      <button
                        type="button"
                        className="lit-line-name"
                        aria-expanded={open}
                        onClick={() => setSelected(open ? null : r.rowId)}
                      >
                        <span className="lit-chevron">
                          <Icon name="right" size={14} />
                        </span>
                        <span className={`dot lit-chip-dot${r.orphan ? ' orphan' : ''}`} style={r.orphan ? undefined : { background: r.color }} />
                        {r.ref && !r.orphan && <span className="card-id">{r.ref}</span>}
                        <span className={`ellipsis lit-line-title${r.orphan ? ' mono' : ''}`}>{r.name}</span>
                        {r.where && !r.orphan && <span className="mono ellipsis lit-line-where">{r.where}</span>}
                        {(r.orphan || r.kept || (!r.taskId && !r.branch)) && (
                          <span className={`tag lunar-tone-${r.orphan ? 'bad' : 'neutral'}`}>{r.kept ? 'sans tâche, voulu' : 'sans tâche'}</span>
                        )}
                        {r.tiny && <span className="tag lunar-tone-warn">moins de 0,05 j</span>}
                      </button>
                      {editable ? (
                        <>
                          <select className="lit-line-label" aria-label={`Étiquette de ${r.name}`} value={r.label} onChange={(e) => setLabel(r.index, e.target.value)}>
                            {[...new Set([...labels, r.label])].filter(Boolean).map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <span className="row lit-line-step" role="group" aria-label={`Part de ${r.name}`}>
                            <button type="button" className="icon-btn" aria-label={`Retirer 0,05 j à ${r.name}`} title="Retirer 0,05 j" disabled={!r.share} onClick={() => step(r.index, -1)}>
                              <Icon name="minus" size={14} />
                            </button>
                            <span className="baloo lit-line-share" aria-live="polite">
                              {fmtShare(r.share)} j
                            </span>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Ajouter 0,05 j à ${r.name}`}
                              title="Ajouter 0,05 j"
                              disabled={r.share >= DAY_SHARES}
                              onClick={() => step(r.index, 1)}
                            >
                              <Icon name="plus" size={14} />
                            </button>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="tag lunar-tone-neutral">{r.label}</span>
                          <span className="baloo lit-line-share">{fmtShare(r.share)}</span>
                        </>
                      )}
                    </div>

                    {/* A branch whose commits belong to no task: settled here, under its line, before sending. */}
                    {editable && r.orphan && (
                      <div className="lit-line-fix" role="group" aria-label={`Branche ${r.where ?? ''}`}>
                        <p>
                          Des commits sur <span className="mono">{r.where}</span> ne sont liés à aucune tâche. C'était pour quoi ?
                        </p>
                        <div className="row lit-attach">
                          <TaskField
                            label="Rattacher à une tâche"
                            placeholder="Titre ou référence…"
                            tasks={offered}
                            done={done}
                            problem={tasksProblem}
                            retry={loadBoard}
                            hint={r.branch ?? undefined}
                            onPick={(t) => void resolve(r.index, { taskId: t.id })}
                          />
                          <button type="button" className="btn" disabled={working} onClick={() => void resolve(r.index, { confirmed: true })}>
                            Garder sans tâche
                          </button>
                        </div>
                      </div>
                    )}

                    {open && (
                      <div className="lit-line-detail">
                        {r.taskId && r.title !== r.name && <span className="legend">{r.title}</span>}
                        {r.reason && <span className="legend">Proposé d'après {r.reason}</span>}
                        {r.start && r.taskId && startButton(r.taskId, r.start.name)}
                        {r.evidence.length > 0 && (
                          <ul className="lit-evidence">
                            {r.evidence.map((s, i) => (
                              <li key={i} className="row">
                                <span className="mono muted">{s.time}</span>
                                <span className="tag lunar-tone-neutral">{s.kind}</span>
                                <span className="ellipsis">{s.detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {extras.length > 0 &&
                          (editable ? (
                            // The Time Log's other properties for this line.
                            <div className="fields">
                              {extras.map((x) =>
                                x.type === 'select' ? (
                                  <label key={x.name} className="field">
                                    {x.name}
                                    <select value={valueOf(r.props, x.name)} onChange={(e) => setProp(r.index, x.name, e.target.value || null)}>
                                      <option value="">—</option>
                                      {(x.options ?? []).map((o) => (
                                        <option key={o} value={o}>
                                          {o}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : x.type === 'multi_select' ? (
                                  <div key={x.name} className="field">
                                    {x.name}
                                    <div className="row lit-chips" role="group" aria-label={x.name}>
                                      {(x.options ?? []).map((o) => {
                                        const value = r.props[x.name]
                                        const current = Array.isArray(value) ? value : []
                                        const on = current.includes(o)
                                        return (
                                          <button
                                            key={o}
                                            type="button"
                                            className="chip-btn"
                                            aria-pressed={on}
                                            onClick={() => setProp(r.index, x.name, on ? current.filter((v) => v !== o) : [...current, o])}
                                          >
                                            {o}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ) : x.type === 'checkbox' ? (
                                  <label key={x.name} className="field lit-check">
                                    <input type="checkbox" checked={r.props[x.name] === true} onChange={(e) => setProp(r.index, x.name, e.target.checked)} />
                                    {x.name}
                                  </label>
                                ) : (
                                  <label key={x.name} className="field">
                                    {x.name}
                                    <input
                                      type={x.type === 'number' ? 'number' : 'text'}
                                      defaultValue={valueOf(r.props, x.name)}
                                      onBlur={(e) => {
                                        const raw = e.target.value
                                        const value = raw === '' ? null : x.type === 'number' ? Number(raw) : raw
                                        if (value !== (r.props[x.name] ?? null)) setProp(r.index, x.name, value)
                                      }}
                                    />
                                  </label>
                                )
                              )}
                            </div>
                          ) : (
                            extras.map((x) => {
                              const v = valueOf(r.props, x.name)
                              return v ? (
                                <span key={x.name} className="legend">
                                  {x.name} : {v}
                                </span>
                              ) : null
                            })
                          ))}
                        <div className="row lit-line-actions">
                          {r.url && (
                            // A button, as the design system draws `btn`: a link would lose its height and be underlined.
                            <button type="button" className="btn" onClick={() => r.url && window.open(r.url, '_blank', 'noopener')}>
                              Ouvrir dans le Time Log
                            </button>
                          )}
                          {editable && (
                            <button type="button" className="btn" onClick={() => remove(r.index)}>
                              Retirer la ligne
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {editable && addRow('lit-add')}
          </>
        ) : (
          view && (
            // A day without lines: what it means, and what can be done about it.
            <div className="lit-empty">
            <Empty
              title={EMPTY_DAY[state]?.[0] ?? EMPTY_DAY.empty[0]}
              action={
                editable && (
                  <>
                    {addRow('lit-empty-add')}
                    {state !== 'off' && (
                      <button type="button" className="btn" disabled={working} onClick={markAbsent}>
                        Marquer absent
                      </button>
                    )}
                  </>
                )
              }
            >
              {EMPTY_DAY[state]?.[1] ?? EMPTY_DAY.empty[1]}
            </Empty>
            </div>
          )
        )}

        {/* The day's send bar: what sending needs, then the button; for a recorded day, when it was sent. */}
        {sendBar ? (
          <footer className="lit-foot" ref={foot}>
            <ul className="lit-checks">
              {checks.map((c, i) => (
                <li key={i} className={`lit-check-line${c.ok ? ' ok' : ''}`}>
                  <span aria-hidden="true">{c.ok ? '✓' : '!'}</span>
                  {c.text}
                </li>
              ))}
            </ul>
            <span className="legend" aria-live="polite">
              {draftNote}
            </span>
            {state === 'modified' && (
              <button type="button" className="btn" disabled={working} onClick={discard}>
                Abandonner les modifications…
              </button>
            )}
            <button type="button" className="btn-cta" disabled={!canSend} onClick={() => void send()}>
              {state === 'modified' ? 'Renvoyer au Time Log' : 'Envoyer au Time Log'}
            </button>
          </footer>
        ) : recorded ? (
          <footer className="lit-foot" ref={foot}>
            <span className="lit-check-line ok">
              <span aria-hidden="true">✓</span>
              Envoyée dans le Time Log {sentAtText(view?.sentAt ?? null)}
            </span>
            <button type="button" className="btn" disabled={working} onClick={reread}>
              Relire le Time Log
            </button>
            <span className="grow" />
            {nextDay && (
              <button type="button" className="btn" onClick={() => go(nextDay.key)}>
                Jour suivant à valider : {dayName(nextDay.key)}
              </button>
            )}
            <button type="button" className="btn" disabled={working} onClick={() => act(api.edit)}>
              Modifier
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  )
}
