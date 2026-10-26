import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  SpaceTools,
  busy,
  navigate,
  objectProviders,
  openDialog,
  react,
  registerCommands,
  relTime,
  runOnApi,
  toast,
  ToolFilter,
  ToolSearch,
  useCommands,
  useOn,
  useSavedState,
  useSettingValues,
  type ObjectProvider,
  type Task,
} from '@bidule/sdk'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import { isMenuKey, useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import { nextTicks } from '@bidule/ext-lunar-industries-common/ui/list'
import { Alert, Empty } from '@bidule/ext-lunar-industries-common/ui/states'
import type { BranchRef, Branches, KanbanBranch } from '../contract.ts'
import {
  board as readBoard,
  branches as readBranches,
  errorMessage,
  reviewUrl,
  setBranches,
  syncTasks,
  writeMove,
  type Loaded,
} from './api.ts'
import { BranchPanel } from './BranchPanel.tsx'
import { Card } from './Card.tsx'
import {
  applicableMerges,
  attentionOf,
  branchKey,
  columnColor,
  columnOf,
  columnWidth,
  COLUMN_MIN,
  dayKey,
  FILTER_LABELS,
  groupsOf,
  matchesFilter,
  matchesQuery,
  moveCandidates,
  openings,
  ORDER,
  orphansOf,
  parseList,
  parseMerges,
  sortTasks,
  WIDTH,
  widthOf,
  type Column,
  type Mark,
  type TaskContext,
  type TaskFilter,
} from './layout.ts'
import { latestOf } from './latest.ts'
import { LinkBranches } from './LinkBranches.tsx'
import { useTaskActions } from './points.ts'

// The columns folded or unfolded against their default, and the role the board shows: hidden settings of the module,
// kept by the API from one launch to the next (useSavedState).
const TOGGLED = 'lunar-industries-kanban.toggled'
const ROLE = 'lunar-industries-kanban.role'
type Role = 'all' | 'owner' | 'participant'
const ROLES: Role[] = ['all', 'owner', 'participant']
const readList = (raw: unknown) => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null)
const readRole = (raw: unknown) => ROLES.find((r) => r === raw) ?? null
// What needs attention, as the row under the banner filters it.
type Attention = Exclude<TaskFilter, Role>


// What a drag carries: cards (to another column, their ids one per line) or a branch of the panel (onto a card).
const TASK_TYPE = 'application/x-lik-task'
const BRANCH_TYPE = 'application/x-lik-branch'
const carries = (e: DragEvent, type: string) => e.dataTransfer.types.includes(type)

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const columnLabel = (name: string) => name || 'Sans statut'
const mergedTip = (column: Column) => (column.merged.length ? `Réunit aussi : ${column.merged.join(', ')}` : undefined)
const isMac = () => window.bidule?.platform === 'darwin'

// The board, read again whenever the core says the tasks changed; only the last reading asked is shown. `readAt`: when
// the one shown was read; `error`: why the last one failed (the board shown stays).
function useBoard() {
  const [board, setBoard] = useState<Loaded | null>(null)
  const [readAt, setReadAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [readLatest] = useState(() => latestOf(readBoard))
  const reload = useCallback(
    () =>
      void readLatest().then(
        (b) => {
          setBoard(b)
          setReadAt(Date.now())
          setError(null)
        },
        (err) => setError(errorMessage(err)),
      ),
    [readLatest],
  )
  useEffect(reload, [reload])
  useOn('objects.changed', ({ type }) => {
    if (type === 'task') reload()
  })
  return { board, setBoard, readAt, error, reload }
}

// What the branches are made of: a change to any of them reads them again.
const BRANCH_TYPES = new Set(['branch', 'repository', 'review', 'pipeline', 'task'])

// The branches, from the core, read again whenever they change; a reading that fails keeps the last ones and says so.
function useBranches() {
  const [branches, setBranches] = useState<Branches>({ available: false, branches: [] })
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(
    () =>
      void readBranches().then(
        (b) => {
          setBranches(b)
          setError(null)
        },
        (err) => setError(errorMessage(err)),
      ),
    [],
  )
  useEffect(reload, [reload])
  useOn('objects.changed', ({ type }) => {
    if (BRANCH_TYPES.has(type)) reload()
  })
  return { git: branches, setGit: setBranches, gitError: error, reloadGit: reload }
}

// Narrower than this, the board shows one stage at a time (maquette « Fenêtre de 900 px »).
const NARROW = '(max-width: 1000px)'
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches)
  useEffect(() => {
    const media = matchMedia(NARROW)
    const change = () => setNarrow(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return narrow
}

/**
 * The board (maquette « Kanban Lunar ») : the search, the role filter, the branches without a task and the sync at the
 * banner's edge; what needs attention in a row under it; then one column per status of the source (less those hidden or
 * merged into another), in the order chosen in Réglages › Kanban, under their stage. Each column scrolls on its own and
 * keeps its head. One stop of Tab for the whole board: the arrows move between the cards, Alt with ← → moves a card to
 * the next column, Enter opens it in its tool, the Menu key its menu; Ctrl+click and Shift+click select several cards.
 */
export function Kanban() {
  const { board, setBoard, readAt, error, reload } = useBoard()
  const { git, setGit, gitError, reloadGit } = useBranches()
  const values = useSettingValues()
  const { actionsFor } = useTaskActions()
  const [toggledList, setToggled] = useSavedState<string[]>(TOGGLED, [], readList)
  const toggled = useMemo((): ReadonlySet<string> => new Set(toggledList), [toggledList])
  const [role, setRole] = useSavedState<Role>(ROLE, 'all', readRole)
  const [attention, setAttention] = useState<Attention | null>(null)
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState(false)
  const panelButton = useRef<HTMLButtonElement>(null)
  const [stage, setStage] = useState<string | null>(null)
  const narrow = useNarrow()
  const [over, setOver] = useState<string | null>(null)
  const [branchOver, setBranchOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  // A card to give the focus once drawn (after it moved to another column).
  const focusNext = useRef<string | null>(null)
  const [menu, openMenu] = useMenu()
  // The active providers of tasks, by id and title: the tools a card opens in, and its tool when there are two.
  const [providers, setProviders] = useState<ObjectProvider[]>([])
  useEffect(() => {
    void objectProviders('task').then(setProviders, () => setProviders([]))
  }, [])

  const hidden = parseList(values?.['lunar-industries-kanban.hidden'])
  const order = parseList(values?.[ORDER])
  const ready = board && board.source !== null ? board : null
  // The board as last drawn, for what runs later (an undo from a notice).
  const latest = useRef(ready)
  useEffect(() => {
    latest.current = ready
  })
  const mergeRaw = values?.['lunar-industries-kanban.statusMerge']
  const merges = useMemo(
    () => applicableMerges(parseMerges(mergeRaw), ready?.columns.map((c) => c.name) ?? []),
    [mergeRaw, ready],
  )
  const groups = useMemo(
    () => (ready ? groupsOf(ready, hidden, toggled, merges, order) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, hidden.join('\n'), toggled, merges, order.join('\n')],
  )
  const columns = groups.flatMap((g) => g.columns)
  const byTask = useMemo(() => {
    const map = new Map<string, KanbanBranch[]>()
    for (const b of git.branches) for (const id of b.taskIds) map.set(id, [...(map.get(id) ?? []), b])
    return map
  }, [git])
  const orphans = orphansOf(git.branches, Date.now(), ready ? new Set(ready.tasks.map((t) => t.id)) : undefined)
  const today = dayKey(new Date())
  const groupOf = (task: Task) => ready?.columns.find((c) => c.name === columnOf(task, merges))?.group ?? null
  const ctx: TaskContext = { done: (t) => groupOf(t) === 'done', branches: (t) => byTask.get(t.id) ?? [], today }
  const attentionCount = ready ? attentionOf(ready.tasks, ctx) : { late: 0, today: 0, ci: 0 }
  const twoTools = providers.length > 1
  const toolOf = (task: Task) => (twoTools ? (providers.find((p) => p.id === task.provider)?.title ?? null) : null)

  // What the board shows: the search, the role and what needs attention, each column sorted (late ones first).
  const shownTasks = (col: Column) =>
    sortTasks(
      col.tasks.filter(
        (t) =>
          matchesQuery(t, query, ctx.branches(t)) &&
          matchesFilter(t, role, ctx) &&
          (attention === null || matchesFilter(t, attention, ctx)),
      ),
      today,
    )
  const stages = groups.reduce<{ key: string; label: string; columns: Column[] }[]>((out, g) => {
    const key = g.label || g.key
    const last = out.at(-1)
    if (last && last.key === key) last.columns.push(...g.columns)
    else out.push({ key, label: g.label || columnLabel(g.columns[0].name), columns: [...g.columns] })
    return out
  }, [])
  const shownStage = narrow ? (stages.find((s) => s.key === stage) ?? stages.find((s) => s.columns.some((c) => !c.folded)) ?? stages[0]) : null
  const shownStages = shownStage ? [shownStage] : stages

  // The columns' width, the same for all (Réglages › Kanban): automatic, it is measured on the board, again when the
  // window changes size or a column is folded. What is not an open column (the gaps, the folded columns) is measured
  // as laid out, so that one pass is enough.
  const widthChoice = widthOf(values?.[WIDTH])
  const boardRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(COLUMN_MIN)
  const layoutKey = shownStages.map((s) => s.columns.map((c) => (c.folded ? 'f' : 'o')).join('')).join('|')
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => {
      const open = [...el.querySelectorAll<HTMLElement>('.lik-column')]
      const current = open[0]?.getBoundingClientRect().width ?? 0
      const stagesShown = [...el.querySelectorAll<HTMLElement>(':scope > .lik-stage')]
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      const content = stagesShown.reduce((sum, s) => sum + s.getBoundingClientRect().width, 0) + gap * Math.max(0, stagesShown.length - 1)
      setWidth(columnWidth(widthChoice, el.clientWidth, content - open.length * current, open.length))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [widthChoice, layoutKey, board])

  // The cards the arrows go through: the open columns shown, and their cards in the order shown.
  const grid = shownStages.flatMap((s) => s.columns.filter((c) => !c.folded).map((c) => ({ column: c, tasks: shownTasks(c) })))
  const firstCard = grid.find((g) => g.tasks.length)?.tasks[0]?.id ?? null
  const activeCard = active !== null && grid.some((g) => g.tasks.some((t) => t.id === active)) ? active : firstCard

  useEffect(() => {
    const id = focusNext.current
    if (!id) return
    focusNext.current = null
    cards.current.get(id)?.focus()
  })

  const toggleFold = (name: string) => {
    const next = new Set(toggled)
    if (!next.delete(name)) next.add(name)
    setToggled([...next])
  }

  // Optimistic: the cards jump to their new column at once; a failure snaps them back. Once moved, the board is read
  // again, as its provider wrote it, and a notice offers to undo it for 8 s.
  const move = async (tasks: Task[], status: string, undoing = false) => {
    // The board as it is now: an undo runs from a notice drawn earlier.
    const now = latest.current
    if (!now) return
    const moving = tasks.filter((t) => columnOf(t, merges) !== status)
    if (!moving.length) return
    const previous = now
    const ids = new Set(moving.map((t) => t.id))
    setBoard({ ...now, tasks: now.tasks.map((t) => (ids.has(t.id) ? { ...t, status } : t)) })
    try {
      await busy(Promise.all(moving.map((t) => writeMove(t, moveCandidates(t, status, merges, now.tasks)))))
    } catch (err) {
      setBoard(previous)
      react('panic', errorMessage(err), errorMessage(err))
      reload()
      return
    }
    reload()
    if (undoing) return
    const done = now.columns.find((c) => c.name === status)?.group === 'done'
    const name = moving.length > 1 ? plural(moving.length, 'tâche', 'tâches') : (moving[0].ref ?? moving[0].title)
    react('quack', done ? `Coin coin ! ${name} ${moving.length > 1 ? 'sont terminées' : 'est terminée'} !` : `${name} → ${columnLabel(status)}, coin !`)
    toast(`${moving.length > 1 ? name : `« ${moving[0].title} »`} → ${columnLabel(status)}`, {
      action: {
        label: 'Annuler',
        run: () => {
          // Each one back to where it was, one status at a time.
          for (const from of new Set(moving.map((t) => t.status)))
            void move(
              moving.filter((t) => t.status === from).map((t) => ({ ...t, status })),
              from,
              true,
            )
        },
      },
    })
  }

  const saveBranches = async (task: Task, refs: BranchRef[]) => {
    try {
      setGit(await busy(setBranches(task.id, refs)))
      toast(`Branches de « ${task.title} » enregistrées`)
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
      throw err
    }
  }
  const refsOf = (taskId: string, without?: KanbanBranch) =>
    (byTask.get(taskId) ?? []).filter((b) => !without || branchKey(b) !== branchKey(without)).map(({ repo, name }) => ({ repo, name }))
  // A branch onto a task: added to its branches, its other tasks kept; the notice offers to take it off again.
  const linkBranch = async (branch: KanbanBranch, task: Task) => {
    try {
      setGit(await busy(setBranches(task.id, [...refsOf(task.id), { repo: branch.repo, name: branch.name }])))
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
      throw err
    }
    toast(`${branch.name} liée à ${task.ref ?? `« ${task.title} »`}`, {
      action: {
        label: 'Annuler',
        run: () =>
          void busy(setBranches(task.id, refsOf(task.id, branch)))
            .then(reloadGit)
            .catch((err: unknown) => react('panic', errorMessage(err), errorMessage(err))),
      },
    })
  }
  const titleOf = (id: string) => ready?.tasks.find((t) => t.id === id)?.title ?? 'une tâche que le tableau ne montre pas'
  const chooseBranches = (task: Task) =>
    openDialog((close) => (
      <LinkBranches
        title={task.title}
        taskId={task.id}
        branches={git.branches}
        titleOf={titleOf}
        save={(refs) => saveBranches(task, refs)}
        close={() => {
          close()
          cards.current.get(task.id)?.focus()
        }}
      />
    ))

  const openUrl = (url: string) => window.open(url, '_blank', 'noopener')
  const openTask = (task: Task) => {
    const [first] = openings(task, providers)
    if (first) openUrl(first.url)
    else react('quack', "Cette tâche n'a pas d'adresse dans son outil. Coin.")
  }
  const openMark = async (mark: Mark) => {
    if (mark.url) return openUrl(mark.url)
    try {
      const { url } = await busy(reviewUrl({ repo: mark.repo, name: mark.name }))
      if (url) openUrl(url)
      else react('quack', 'Je ne trouve ni la revue ni le pipeline de cette branche. Coin.')
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    }
  }
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => toast(`${what} copié${what.endsWith('lien') ? '' : 'e'}`))

  // A command the other modules contribute to the menu: its id is known at run time only, so it is looked up (as
  // `execute` does for a known one) rather than typed.
  const commands = useCommands()
  const runCommand = (id: string, args: unknown) => {
    const command = commands.find((c) => c.id === id)
    return command ? command.run(args) : runOnApi(id, args)
  }

  // The cards a gesture acts on: the selection when the card is part of it, else the card alone.
  const actedOn = (task: Task) => (selected.has(task.id) && selected.size > 1 ? (ready?.tasks.filter((t) => selected.has(t.id)) ?? [task]) : [task])

  const entriesFor = (task: Task): MenuEntry[] => {
    const tasks = actedOn(task)
    const several = tasks.length > 1
    const current = columnOf(task, merges)
    const reviews = (byTask.get(task.id) ?? []).filter((b) => b.url)
    const actions = actionsFor(groupOf(task))
    return [
      ...(several
        ? []
        : openings(task, providers).map((o, i) => ({ label: `Ouvrir dans ${o.title}`, run: () => openUrl(o.url), shortcut: i === 0 ? 'Entrée' : undefined }))),
      !several && reviews.length === 1 && { label: 'Ouvrir la revue', run: () => openUrl(reviews[0].url!) },
      ...(several ? [] : actions.map((a) => ({ label: a.title, run: () => runCommand(a.command, { taskId: task.id }) }))),
      'separator',
      !several && git.available && { label: 'Lier des branches…', run: () => chooseBranches(task) },
      !several && { label: "Copier l'ID", run: () => copy(task.ref ?? task.id, "L'ID") },
      !several && task.url ? { label: 'Copier le lien', run: () => copy(task.url!, 'Le lien') } : null,
      'separator',
      ...columns
        .filter((c) => c.name !== current)
        .map((c) => ({
          label: several ? `Déplacer les ${tasks.length} tâches vers ${columnLabel(c.name)}` : `Déplacer vers ${columnLabel(c.name)}`,
          run: () => move(tasks, c.name),
        })),
      several && 'separator',
      several && { label: 'Tout désélectionner', run: () => setSelected(new Set()), shortcut: 'Échap' },
    ]
  }

  // The keys of a card (the board's one stop of Tab): the arrows, Home and End move; Alt with ← → moves it to the
  // next column; Enter opens it; Space selects it; the Menu key opens its menu; Escape lets the selection go.
  const onCardKey = (task: Task, at: { col: number; row: number }) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return
    const go = (col: number, row: number) => {
      const target = grid[col]
      if (!target?.tasks.length) return
      const next = target.tasks[Math.max(0, Math.min(row, target.tasks.length - 1))]
      setActive(next.id)
      cards.current.get(next.id)?.focus()
    }
    // The next open column with cards, to the left or the right.
    const neighbour = (step: number) => {
      for (let c = at.col + step; c >= 0 && c < grid.length; c += step) if (grid[c].tasks.length) return c
      return null
    }
    if (isMenuKey(e)) return openMenu(e, entriesFor(task), `Actions sur ${task.title}`)
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      const to = grid[at.col + (e.key === 'ArrowLeft' ? -1 : 1)]?.column ?? null
      if (!to) return
      focusNext.current = task.id
      return void move(actedOn(task), to.name)
    }
    const mod = isMac() ? e.metaKey : e.ctrlKey
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      return setSelected(new Set(grid.flatMap((g) => g.tasks.map((t) => t.id))))
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const keys: Record<string, () => void> = {
      ArrowDown: () => go(at.col, at.row + 1),
      ArrowUp: () => go(at.col, at.row - 1),
      ArrowLeft: () => {
        const c = neighbour(-1)
        if (c !== null) go(c, at.row)
      },
      ArrowRight: () => {
        const c = neighbour(1)
        if (c !== null) go(c, at.row)
      },
      Home: () => go(at.col, 0),
      End: () => go(at.col, Number.MAX_SAFE_INTEGER),
      Enter: () => openTask(task),
      ' ': () => {
        const next = nextTicks(selected, grid[at.col].tasks.map((t) => t.id), task.id, { shift: e.shiftKey, anchor })
        setSelected(next.ticked)
        setAnchor(next.anchor)
      },
      Escape: () => setSelected(new Set()),
    }
    if (e.key === 'Escape' && !selected.size) return
    const key = keys[e.key]
    if (!key) return
    e.preventDefault()
    if (e.key === 'Escape') e.stopPropagation()
    key()
  }
  // A click selects with Ctrl (⌘ on macOS) or Shift, else lets the selection go; the card gets the focus either way.
  const onCardClick = (task: Task, col: number) => (e: MouseEvent<HTMLElement>) => {
    setActive(task.id)
    const mod = isMac() ? e.metaKey : e.ctrlKey
    if (!mod && !e.shiftKey) {
      if (selected.size) setSelected(new Set())
      return
    }
    const next = nextTicks(selected, grid[col]?.tasks.map((t) => t.id) ?? [], task.id, { shift: e.shiftKey, anchor })
    setSelected(next.ticked)
    setAnchor(next.anchor)
  }

  const dropOnColumn = (column: Column) => ({
    onDragOver: (e: DragEvent) => {
      if (!carries(e, TASK_TYPE)) return
      e.preventDefault()
      setOver(column.name)
    },
    onDragLeave: () => setOver((o) => (o === column.name ? null : o)),
    onDrop: (e: DragEvent) => {
      setOver(null)
      setDragging(false)
      if (!carries(e, TASK_TYPE)) return
      e.preventDefault()
      const ids = new Set(e.dataTransfer.getData(TASK_TYPE).split('\n'))
      const tasks = ready?.tasks.filter((t) => ids.has(t.id)) ?? []
      if (tasks.length) void move(tasks, column.name)
    },
  })
  const dropOnCard = (task: Task) => ({
    onDragOver: (e: DragEvent) => {
      if (!carries(e, BRANCH_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'link'
      setBranchOver(task.id)
    },
    onDragLeave: () => setBranchOver((o) => (o === task.id ? null : o)),
    onDrop: (e: DragEvent) => {
      setBranchOver(null)
      if (!carries(e, BRANCH_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      const branch = git.branches.find((b) => branchKey(b) === e.dataTransfer.getData(BRANCH_TYPE))
      if (branch) void linkBranch(branch, task).catch(() => undefined)
    },
  })
  const dragCard = (task: Task) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(TASK_TYPE, actedOn(task).map((t) => t.id).join('\n'))
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }
  const dragBranch = (e: DragEvent<HTMLElement>, branch: KanbanBranch) => {
    e.dataTransfer.setData(BRANCH_TYPE, branchKey(branch))
    e.dataTransfer.setData('text/plain', branch.name)
    e.dataTransfer.effectAllowed = 'link'
  }
  useEffect(() => {
    const end = () => setDragging(false)
    addEventListener('dragend', end)
    return () => removeEventListener('dragend', end)
  }, [])

  const sync = () =>
    void busy(syncTasks()).then(
      () => toast(`${ready?.source ?? 'La source'} relue`),
      (err: unknown) => react('panic', errorMessage(err), errorMessage(err)),
    )
  useEffect(
    () => registerCommands({ id: 'lunar-industries-kanban.sync', group: 'Kanban', title: 'Synchroniser les tâches', run: sync }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready?.source],
  )

  const tools = (
    <SpaceTools>
      <ToolSearch label="Chercher une tâche" placeholder="Titre, référence, branche…" value={query} onChange={setQuery} />
      <ToolFilter
        label="Rôle"
        options={ROLES.map((key) => ({ key, label: FILTER_LABELS[key] }))}
        value={role}
        onChange={setRole}
      />
      {git.available && (
        <button
          ref={panelButton}
          type="button"
          className="banner-button lik-panel-toggle"
          aria-expanded={panel}
          title="Les branches récentes sans tâche"
          onClick={() => setPanel(!panel)}
        >
          Branches sans tâche {orphans.length > 0 && <span className="pill-count">{orphans.length}</span>}
        </button>
      )}
      <button type="button" className="banner-button round" aria-label="Synchroniser" title="Synchroniser les tâches" onClick={sync}>
        <Icon name="sync" />
      </button>
    </SpaceTools>
  )

  // The states without a board: each one with what to do next (maquette « États sans tableau »).
  if (!board) {
    return (
      <div className="page">
        {error ? (
          <Empty title="Le Kanban n'a pas pu lire tes tâches." failed action={{ label: 'Réessayer', run: reload }}>
            {error}
          </Empty>
        ) : (
          <div className="lik-loading">
            <p className="muted" role="status">
              Lecture des tâches…
            </p>
            <div className="lik-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
    )
  }
  if (board.source === null || !board.configured || !board.tasks.length) {
    const settingsOf = providers[0]?.id
    return (
      <div className="page">
        {tools}
        {board.source === null ? (
          <Empty
            title="Aucune source de tâches"
            action={
              <button type="button" className="btn-cta" onClick={() => navigate('/reglages/extensions')}>
                Installer une source de tâches
              </button>
            }
          >
            Le Kanban montre les tâches d'une extension comme Notion ou Plane.
          </Empty>
        ) : !board.configured ? (
          <Empty
            title={`${board.source} n'est pas encore branché`}
            action={
              <button type="button" className="btn-cta" onClick={() => navigate(settingsOf ? `/reglages/${settingsOf}` : '/reglages')}>
                Ouvrir les réglages de {board.source}
              </button>
            }
          >
            Le Kanban lit tes tâches dans {board.source}. Donne-lui ce qu'il demande dans ses réglages.
          </Empty>
        ) : (
          <Empty
            title="Aucune tâche où tu as un rôle"
            action={
              <>
                <div className="row lik-empty-actions">
                  <button type="button" className="btn" onClick={sync}>
                    Synchroniser
                  </button>
                  {hidden.length > 0 && (
                    <button type="button" className="btn" onClick={() => navigate('/reglages/lunar-industries-kanban')}>
                      Voir les statuts masqués
                    </button>
                  )}
                </div>
                {readAt && <span className="legend">Lu {relTime(new Date(readAt).toISOString())}</span>}
              </>
            }
          >
            {board.source} n'a aucune tâche où tu es responsable ou participant. Si tu viens d'en créer une, relis {board.source}.
          </Empty>
        )}
      </div>
    )
  }

  const chip = (key: Attention, count: number, label: string) =>
    count > 0 && (
      <button
        type="button"
        className={`lik-attention lik-attention-${key}`}
        aria-pressed={attention === key}
        onClick={() => setAttention(attention === key ? null : key)}
      >
        {label}
      </button>
    )
  const filtered = query.trim() !== '' || role !== 'all' || attention !== null

  return (
    <div className="page fill lik-page">
      {tools}
      {error && (
        <Alert retry={reload}>
          Les tâches n'ont pas pu être relues : {error} Le tableau montre la lecture{' '}
          {readAt ? relTime(new Date(readAt).toISOString()) : "d'avant"}.
        </Alert>
      )}
      {gitError && <Alert retry={reloadGit}>Les branches n'ont pas pu être lues : {gitError}</Alert>}
      <div className="row lik-attention-row" role="group" aria-label="À surveiller">
        {(attentionCount.late > 0 || attentionCount.today > 0 || attentionCount.ci > 0) && <span className="lik-attention-title">À surveiller</span>}
        {chip('late', attentionCount.late, plural(attentionCount.late, 'en retard', 'en retard'))}
        {chip('today', attentionCount.today, `${attentionCount.today} pour aujourd'hui`)}
        {chip('ci', attentionCount.ci, plural(attentionCount.ci, 'CI rouge', 'CI rouges'))}
        <span className="grow" />
        {filtered && (
          <button
            type="button"
            className="chip-btn"
            onClick={() => {
              setQuery('')
              setRole('all')
              setAttention(null)
            }}
          >
            Tout montrer
          </button>
        )}
        <span className="legend">
          {readAt && `Lu dans ${ready!.source} ${relTime(new Date(readAt).toISOString())} · `}
          {plural(ready!.tasks.length, 'tâche', 'tâches')}
        </span>
      </div>
      {narrow && (
        <div className="row lik-stage-tabs" role="tablist" aria-label="Étapes">
          {stages.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s === shownStage}
              className="chip-btn"
              onClick={() => setStage(s.key)}
            >
              {s.label} · {s.columns.reduce((n, c) => n + shownTasks(c).length, 0)}
            </button>
          ))}
        </div>
      )}
      <div ref={boardRef} className={`lik-board${dragging ? ' dragging' : ''}`} style={{ '--lik-col': `${width}px` } as CSSProperties}>
        {shownStages.map((s) => (
          <section key={s.key} className="lik-stage" aria-label={s.label}>
            {!narrow && (
              <h2 className="lik-stage-title">
                <span>{s.label}</span>
              </h2>
            )}
            <div className="lik-stage-columns">
              {s.columns.map((col) => {
                const tasks = shownTasks(col)
                const at = grid.findIndex((g) => g.column === col)
                return col.folded ? (
                  <button
                    key={col.name}
                    type="button"
                    className={`lik-folded${over === col.name ? ' drop-over' : ''}`}
                    aria-expanded="false"
                    title={`Déplier ${columnLabel(col.name)}`}
                    onClick={() => toggleFold(col.name)}
                    {...dropOnColumn(col)}
                  >
                    <span className="dot" style={{ background: columnColor(col) }} />
                    <span className="pill-count">{tasks.length}</span>
                    <span className="lik-folded-name">{columnLabel(col.name)}</span>
                  </button>
                ) : (
                  <section
                    key={col.name}
                    className={`lik-column${over === col.name ? ' drop-over' : ''}`}
                    aria-label={columnLabel(col.name)}
                    {...dropOnColumn(col)}
                  >
                    <h3 className="lik-column-head">
                      <button type="button" className="lik-column-toggle" aria-expanded="true" title={mergedTip(col) ?? `Replier ${columnLabel(col.name)}`} onClick={() => toggleFold(col.name)}>
                        <Icon name="down" size={12} />
                        <span className="dot" style={{ background: columnColor(col) }} />
                        <span className="grow ellipsis">{columnLabel(col.name)}</span>
                        {col.unknown && <span className="tag lunar-tone-warn">absent de {ready!.source}</span>}
                        <span className="pill-count">{tasks.length}</span>
                      </button>
                    </h3>
                    <div className="lik-cards" role="list" aria-label={`Tâches ${columnLabel(col.name)}`}>
                      {tasks.map((t, row) => (
                        <Card
                          key={t.id}
                          task={t}
                          done={ctx.done(t)}
                          today={today}
                          branches={ctx.branches(t)}
                          tool={toolOf(t)}
                          active={t.id === activeCard}
                          selected={selected.has(t.id)}
                          branchOver={branchOver === t.id}
                          cardRef={(el) => {
                            if (el) cards.current.set(t.id, el)
                            else cards.current.delete(t.id)
                          }}
                          onKeyDown={onCardKey(t, { col: at, row })}
                          onClick={onCardClick(t, at)}
                          onOpen={() => openTask(t)}
                          onMenu={(e) => {
                            setActive(t.id)
                            openMenu(e, entriesFor(t), `Actions sur ${t.title}`)
                          }}
                          onMark={(m) => void openMark(m)}
                          drag={dragCard(t)}
                          drop={dropOnCard(t)}
                        />
                      ))}
                      {!tasks.length && (
                        <p className="lik-drop-hint">{dragging ? 'Lâche la carte ici' : filtered && col.tasks.length ? 'Aucune tâche ne correspond' : ''}</p>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      {panel && (
        <BranchPanel
          branches={orphans}
          tasks={ready!.tasks}
          titleOf={titleOf}
          done={ctx.done}
          link={linkBranch}
          drag={dragBranch}
          close={() => setPanel(false)}
        />
      )}
      {menu}
    </div>
  )
}
