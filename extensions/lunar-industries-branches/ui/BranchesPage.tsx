import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import {
  BannerTools,
  busy,
  errorMessage,
  navigate,
  react,
  ToolFilter,
  ToolSearch,
  useHint,
  useMascot,
  useOn,
  type Board,
} from '@bidule/sdk'
import { isMenuKey, useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import type { Job, Links, Listing } from '../contract.ts'
import { api, board as readBoard } from './api.ts'
import { confirm, type Ask } from './confirm.tsx'
import { setOpened, useOpened } from './state.ts'
import { countsOf, FILTERS, hintOf, relTime, reposOf, type Filter, type RepoView, type Row, type Sort } from './steps.ts'
import { TaskPicker } from './TaskPicker.tsx'

// Kept across visits while the app runs: the filter, the order, the repos folded.
let keptFilter: Filter = 'current'
let keptSort: Sort = 'state'
const keptFolded = new Set<string>()

type Read = 'loading' | { error: string } | Links
const open = (url: string | null) => url && window.open(url, '_blank', 'noopener')

// Under this width the table keeps its essential columns and the drawer takes the whole page.
const NARROW = '(max-width: 1000px)'
const subscribeNarrow = (changed: () => void) => {
  const query = matchMedia(NARROW)
  query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches)

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

/**
 * Taken from quack-board (Simon's pages/branches), as the « Branches Lunar » maquette draws it (piste C): every branch
 * of the user's repos in one table, grouped by repo, with the step it is at in words and the one thing to do now in its
 * last column; the drawer of the branch chosen says its situation, its task, its steps and every action. Every write on
 * the forge or on origin is confirmed first, in full sentences.
 */
export function BranchesPage() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [board, setBoard] = useState<Board | 'none' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilterState] = useState<Filter>(keptFilter)
  const [sort, setSortState] = useState<Sort>(keptSort)
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<Set<string>>(() => new Set(keptFolded))
  const [active, setActive] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const opened = useOpened()
  const narrow = useNarrow()
  const [menu, openMenu] = useMenu()
  const { mascot } = useMascot()
  const table = useRef<HTMLTableElement>(null)

  const reload = useCallback(() => {
    api.list().then(
      (l) => {
        setListing(l)
        setError(null)
      },
      (err: unknown) => setError(errorMessage(err)),
    )
    void readBoard().then(setBoard)
  }, [])
  useEffect(reload, [reload])
  useOn('git.changed', reload)
  // The forges' reviews and CI read again, the tasks and the branches changed.
  useOn('objects.changed', ({ type }) => {
    if (type === 'review' || type === 'pipeline' || type === 'task' || type === 'branch') reload()
  })
  // A repo's review target changed, here or in Claude's settings.
  useOn('lunar-industries-common.changed', reload)

  const setFilter = (f: Filter) => {
    keptFilter = f
    setFilterState(f)
  }
  const setSort = (s: Sort) => {
    keptSort = s
    setSortState(s)
  }
  const fold = (path: string) => {
    if (keptFolded.has(path)) keptFolded.delete(path)
    else keptFolded.add(path)
    setFolded(new Set(keptFolded))
  }

  const tasks = board && board !== 'none' ? board.tasks : []
  const done = useMemo(
    () => new Set((board && board !== 'none' ? board.columns : []).filter((c) => c.group === 'done').map((c) => c.name)),
    [board],
  )
  const repos = useMemo(() => (listing ? reposOf(listing, tasks, filter, sort, query) : []), [listing, tasks, filter, sort, query])
  const visible = repos.flatMap((r) => (folded.has(r.path) ? [] : r.rows))
  const all = repos.flatMap((r) => r.rows)
  const counts = listing ? countsOf(listing.branches) : null
  const openRow = all.find((r) => r.key === opened) ?? null
  const openRepo = openRow ? (repos.find((r) => r.path === openRow.repo) ?? null) : null
  const activeKey = active && visible.some((r) => r.key === active) ? active : (openRow?.key ?? visible[0]?.key ?? null)

  const hint = listing ? hintOf(listing, mascot?.lines.tease ?? null) : null
  useHint(error && !listing ? 'Je n’arrive pas à lire tes dépôts.' : (hint?.line ?? null), hint?.mode ?? 'listen')

  // ---------- writes: each confirmed, the wait shown, the table read again

  const write = async (ask: Ask, call: () => Promise<unknown>, doneText: string) => {
    if (!(await confirm(ask))) return
    setWriting(true)
    try {
      await busy(call())
      react('quack', doneText, doneText)
      reload()
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    } finally {
      setWriting(false)
    }
  }
  const push = (r: Row) =>
    write(
      {
        title: `Pousser ${r.name} ?`,
        text: `Les commits de ${r.name} sont envoyés sur origin, sans jamais forcer. La première fois, la branche y est créée et suivie.`,
        confirm: 'Pousser',
      },
      () => api.push(r),
      `${r.name} poussée`,
    )
  const createReview = (r: Row, target: string) =>
    write(
      {
        title: `Créer la ${r.review} brouillon ?`,
        text: `Une ${r.review} brouillon de ${r.name} vers ${target} est ouverte sur ${r.forgeName}, intitulée « ${r.task?.title ?? r.name} ».`,
        confirm: `Créer la ${r.review}`,
      },
      () => api.review(r, target),
      `${r.review} brouillon ouverte pour ${r.name}`,
    )
  const ready = (r: Row) =>
    write(
      {
        title: `Sortir la ${r.reviewLabel ?? r.review} du brouillon ?`,
        text: `La ${r.reviewLabel ?? r.review} de ${r.name} devient prête à être relue sur ${r.forgeName}.`,
        confirm: 'Sortir du brouillon',
      },
      () => api.ready(r),
      `${r.reviewLabel ?? r.review} prête à être relue`,
    )
  const merge = (r: Row) =>
    write(
      {
        title: `Fusionner la ${r.reviewLabel ?? r.review} ?`,
        text: `La ${r.reviewLabel ?? r.review} de ${r.name} est fusionnée dans sa branche cible sur ${r.forgeName}, comme son bouton là-bas. Cela ne se défait pas depuis l’app.`,
        confirm: 'Fusionner',
      },
      () => api.merge(r),
      `${r.reviewLabel ?? r.review} fusionnée`,
    )
  const runPipeline = (r: Row) =>
    write(
      {
        title: `Lancer un pipeline sur ${r.name} ?`,
        text: `Un nouveau pipeline démarre sur ${r.forgeName} pour le dernier commit poussé de ${r.name}.`,
        confirm: 'Lancer',
      },
      () => api.pipeline(r),
      `Pipeline lancé sur ${r.name}`,
    )
  const retry = (r: Row) =>
    write(
      {
        title: 'Relancer les jobs en échec ?',
        text: `Les jobs en échec du dernier pipeline de ${r.name} redémarrent sur ${r.forgeName}.`,
        confirm: 'Relancer',
      },
      () => api.retry(r),
      `Jobs relancés sur ${r.name}`,
    )
  const play = (r: Row, job: Job) =>
    write(
      {
        title: `Lancer ${job.name} ?`,
        text: `Le job manuel ${job.stage ? `${job.stage} · ` : ''}${job.name} du pipeline de ${r.name} démarre sur ${r.forgeName}.`,
        confirm: 'Lancer',
      },
      () => api.play(r, job.id),
      `${job.name} lancé`,
    )
  const link = async (r: Row, taskId: string | null) => {
    try {
      await api.link(r, taskId)
      if (!taskId) return react('quack', `${r.name} n'est plus liée à une tâche`, `${r.name} n'est plus liée à une tâche`)
      const t = tasks.find((x) => x.id === taskId)
      react('quack', `Coin ! ${r.name} va avec « ${t?.title ?? taskId} ».`, `${r.name} liée à ${t?.title ?? taskId}`)
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    }
  }
  // The repo's target: kept for its next reviews.
  const setTarget = async (repo: string, target: string) => {
    try {
      await api.target(repo, target || null)
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    }
  }
  const copy = async (name: string) => {
    await navigator.clipboard.writeText(name)
    react('quack', `${name} copié`, `${name} copié`)
  }

  // ---------- the drawer, and the row's action

  const show = (r: Row, focusTask = false) => {
    setActive(r.key)
    setOpened(r.key)
    if (focusTask) setTimeout(() => document.querySelector<HTMLInputElement>('.lib-drawer .lib-picker input')?.focus())
  }
  const dismiss = useCallback(() => setOpened(null), [])
  const close = () => {
    const key = opened
    setOpened(null)
    // The focus goes back to the table, on the row that was open.
    if (key) {
      setActive(key)
      table.current?.focus()
    }
  }
  const act = (r: Row) => {
    const repo = repos.find((x) => x.path === r.repo)
    switch (r.action.kind) {
      case 'link':
        return show(r, true)
      case 'push':
        return void push(r)
      case 'review':
        return repo?.target ? void createReview(r, repo.target) : show(r)
      case 'retry':
        return void retry(r)
      case 'ready':
        return void ready(r)
      case 'merge':
        return void merge(r)
      default:
        return show(r)
    }
  }
  const entriesFor = (r: Row): MenuEntry[] => [
    { label: 'Ouvrir le détail', run: () => show(r), shortcut: 'Entrée' },
    { label: 'Copier le nom', run: () => copy(r.name) },
    !r.taskId && { label: 'Lier à une tâche…', run: () => show(r, true) },
    r.forge ? { label: 'Lancer un pipeline…', run: () => runPipeline(r) } : null,
  ]

  // The table's keys: one stop for Tab; the arrows go from row to row, Enter opens the drawer, the Menu key the row's
  // menu, Escape closes the drawer.
  const onTableKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const at = visible.findIndex((r) => r.key === activeKey)
    const row = visible[at]
    // The Menu key: the row's menu, under the row (not under the whole table).
    const rowEl = row ? document.getElementById(rowId(row.key)) : null
    if (isMenuKey(e) && row && rowEl) {
      e.preventDefault()
      return openMenu(rowEl, entriesFor(row), `Branche ${row.name}`)
    }
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : null
    if (to !== null && visible.length) {
      e.preventDefault()
      const next = visible[Math.max(0, Math.min(visible.length - 1, to))]
      setActive(next.key)
      // The panel open follows the row chosen.
      if (opened) setOpened(next.key)
      document.getElementById(rowId(next.key))?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && row) {
      e.preventDefault()
      show(row)
    } else if (e.key === 'Escape' && opened) {
      e.preventDefault()
      close()
    }
  }

  const tools = (
    <BannerTools>
      <ToolSearch label="Chercher une branche" placeholder="Branche, dépôt, tâche…" value={query} onChange={setQuery} />
      <ToolFilter
        label="Branches affichées"
        options={FILTERS.map((f) => ({ ...f, count: counts?.[f.key] }))}
        value={filter}
        onChange={setFilter}
      />
    </BannerTools>
  )

  if (!listing)
    return (
      <div className="page with-tools lib-page">
        {tools}
        {error ? (
          <div className="row lib-alert" role="alert">
            <span className="grow">Les dépôts n’ont pas pu être lus : {error}</span>
            <button type="button" className="btn lib-btn-sm" onClick={reload}>
              Réessayer
            </button>
          </div>
        ) : (
          <p className="muted" role="status">
            Lecture des dépôts…
          </p>
        )}
      </div>
    )
  if (!listing.repos.length && !listing.branches.length)
    return (
      <div className="page with-tools lib-page">
        {tools}
        <section className="empty lib-none">
          <p>Je ne vois aucun dépôt.</p>
          <p className="legend">Vérifie le dossier des dépôts dans les Réglages de git.</p>
          <button type="button" className="btn" onClick={() => navigate('/reglages/git')}>
            Aller aux Réglages
          </button>
        </section>
      </div>
    )

  return (
    <div className={`page with-tools lib-page${narrow ? ' narrow' : ''}`}>
      {tools}
      {menu}
      <div className="lib-main">
        {error && (
          <div className="row lib-alert" role="alert">
            <span className="grow">Les branches n’ont pas pu être relues : {error} Voici la dernière lecture.</span>
            <button type="button" className="btn lib-btn-sm" onClick={reload}>
              Réessayer
            </button>
          </div>
        )}
        {all.length ? (
          <section className="panel lib-table-panel">
            <table
              ref={table}
              className="lib-table"
              role="grid"
              aria-label="Branches"
              tabIndex={0}
              aria-activedescendant={activeKey ? rowId(activeKey) : undefined}
              onKeyDown={onTableKey}
            >
              <thead>
                <tr>
                  <th scope="col" className="lib-col-dot">
                    <span className="sr-only">Attend quelque chose de toi</span>
                  </th>
                  <SortHead label="Branche" by="name" sort={sort} setSort={setSort} />
                  <th scope="col" className="lib-col-task">
                    Tâche
                  </th>
                  <SortHead label="État" by="state" sort={sort} setSort={setSort} />
                  <th scope="col" className="lib-col-extra">
                    Revue
                  </th>
                  <th scope="col" className="lib-col-extra">
                    CI
                  </th>
                  <SortHead label="Commit" by="commit" sort={sort} setSort={setSort} extra />
                  <th scope="col" className="lib-col-action">
                    Action
                  </th>
                </tr>
              </thead>
              {repos
                .filter((repo) => repo.rows.length)
                .map((repo) => (
                  <tbody key={repo.path}>
                    <tr className="lib-group-row">
                      <td colSpan={8}>
                        <button type="button" className="lib-group-fold" aria-expanded={!folded.has(repo.path)} onClick={() => fold(repo.path)}>
                          <span className="lib-chevron" aria-hidden="true">
                            ›
                          </span>
                          <span className="baloo lib-group-name">{repo.label}</span>
                          <span className="legend">
                            {plural(repo.rows.length, 'branche')}
                            {repo.yours ? ` · ${repo.yours} attend${repo.yours > 1 ? 'ent' : ''} quelque chose de toi` : ''}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!folded.has(repo.path) &&
                      repo.rows.map((r) => (
                        <TableRow
                          key={r.key}
                          row={r}
                          active={r.key === activeKey}
                          open={r.key === opened}
                          busy={writing}
                          show={() => show(r)}
                          act={() => act(r)}
                          menu={(e) => openMenu(e, entriesFor(r), `Branche ${r.name}`)}
                        />
                      ))}
                  </tbody>
                ))}
            </table>
          </section>
        ) : (
          <section className="empty lib-none">
            {query.trim() ? (
              <>
                <p>Aucune branche ne correspond à « {query.trim()} ».</p>
                <button type="button" className="btn" onClick={() => setQuery('')}>
                  Effacer la recherche
                </button>
              </>
            ) : filter === 'orphans' ? (
              <p>Chaque branche a sa tâche. Coin !</p>
            ) : (
              <>
                <p>Aucune branche en cours.</p>
                {counts && counts.all > 0 && (
                  <button type="button" className="btn" onClick={() => setFilter('all')}>
                    Voir toutes les branches ({counts.all})
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {openRow && openRepo && (
        <Drawer
          key={openRow.key}
          row={openRow}
          repo={openRepo}
          tasks={tasks}
          done={done}
          noSource={board === 'none'}
          branches={listing.branches}
          busy={writing}
          narrow={narrow}
          close={close}
          dismiss={dismiss}
          menu={(el) => openMenu(el, entriesFor(openRow), `Branche ${openRow.name}`)}
          jobsMenu={(el, entries) => openMenu(el, entries, 'Jobs manuels')}
          link={(id) => void link(openRow, id)}
          push={() => void push(openRow)}
          createReview={(t) => void createReview(openRow, t)}
          ready={() => void ready(openRow)}
          merge={() => void merge(openRow)}
          run={() => void runPipeline(openRow)}
          retry={() => void retry(openRow)}
          play={(job) => void play(openRow, job)}
          setTarget={(t) => void setTarget(openRepo.path, t)}
        />
      )}
    </div>
  )
}

const rowId = (key: string) => `lib-${key.replace(/[^\w-]/g, '_')}`

function SortHead({ label, by, sort, setSort, extra }: { label: string; by: Sort; sort: Sort; setSort: (s: Sort) => void; extra?: boolean }) {
  const on = sort === by
  return (
    <th scope="col" className={extra ? 'lib-col-extra' : undefined} aria-sort={on ? (by === 'commit' ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="lib-sort" aria-pressed={on} title={`Trier par ${label.toLowerCase()}`} onClick={() => setSort(by)}>
        {label}
        {on && <span aria-hidden="true">{by === 'commit' ? ' ↓' : ' ↑'}</span>}
      </button>
    </th>
  )
}

function TableRow({
  row: r,
  active,
  open,
  busy,
  show,
  act,
  menu,
}: {
  row: Row
  active: boolean
  open: boolean
  busy: boolean
  show: () => void
  act: () => void
  menu: (e: MouseEvent) => void
}) {
  const writes = r.action.kind !== 'open' && r.action.kind !== 'link'
  return (
    <tr
      id={rowId(r.key)}
      role="row"
      aria-selected={open}
      className={`lib-row${active ? ' active' : ''}${open ? ' open' : ''}`}
      data-tone={r.state.tone}
      onClick={show}
      onContextMenu={menu}
    >
      <td className="lib-col-dot">{r.state.yours && <span className="dot lib-dot" data-tone={r.state.tone} />}</td>
      <td>
        <span className="lib-branch">
          <span className="mono lib-name">{r.name}</span>
          <span className="legend lib-sub">{r.task ? `${r.task.ref ? `${r.task.ref} · ` : ''}${r.task.title}` : r.taskId ? 'Tâche inconnue' : 'aucune tâche'}</span>
        </span>
      </td>
      <td className="lib-col-task">
        {r.task ? (
          <span className="ellipsis">
            {r.task.ref && <span className="card-id">{r.task.ref} </span>}
            {r.task.title}
          </span>
        ) : (
          <span className="muted">{r.taskId ? `Tâche inconnue · ${r.taskId.slice(0, 6)}` : 'aucune'}</span>
        )}
      </td>
      <td>
        <span className="lib-state">
          <span className="lib-progress" aria-hidden="true">
            {r.progress.map((d, i) => (
              <span key={i} className={d ? 'done' : undefined} />
            ))}
          </span>
          <span className="lib-state-text" data-tone={r.state.tone}>
            {r.state.text}
          </span>
        </span>
      </td>
      <td className="lib-col-extra muted">{r.reviewLabel ? `${r.reviewLabel}${r.reviewDraft ? ' · brouillon' : ''}` : '—'}</td>
      <td className="lib-col-extra">
        <span className="lib-ci" data-ci={r.ci ?? 'none'}>
          {r.ci === 'fail' ? 'rouge' : r.ci === 'ok' ? 'verte' : r.ci === 'pending' ? 'en cours' : '—'}
        </span>
      </td>
      <td className="lib-col-extra muted">{relTime(r.lastCommitAt)}</td>
      <td className="lib-col-action">
        <button
          type="button"
          className={writes && r.state.yours ? 'btn-cta lib-btn-sm' : 'btn lib-btn-sm'}
          tabIndex={-1}
          disabled={busy && writes}
          onClick={(e) => {
            e.stopPropagation()
            act()
          }}
        >
          {r.action.label}
        </button>
      </td>
    </tr>
  )
}

function Drawer({
  row: r,
  repo,
  tasks,
  done,
  noSource,
  branches,
  busy,
  narrow,
  close,
  dismiss,
  menu,
  jobsMenu,
  link,
  push,
  createReview,
  ready,
  merge,
  run,
  retry,
  play,
  setTarget,
}: {
  row: Row
  repo: RepoView
  tasks: Board['tasks']
  done: Set<string>
  noSource: boolean
  branches: Listing['branches']
  busy: boolean
  narrow: boolean
  close: () => void
  // Closed by a click outside it: the focus stays where that click put it.
  dismiss: () => void
  menu: (el: HTMLElement) => void
  jobsMenu: (el: HTMLElement, entries: MenuEntry[]) => void
  link: (taskId: string | null) => void
  push: () => void
  createReview: (target: string) => void
  ready: () => void
  merge: () => void
  run: () => void
  retry: () => void
  play: (job: Job) => void
  setTarget: (target: string) => void
}) {
  // Where its review, pipeline and issue are, read on the forge (again after a change of the branch).
  const box = useRef<HTMLElement>(null)
  // Over the page: a click outside it closes it, except on a row of the table (which opens that row instead), in a
  // menu, or while a dialog (a confirmation) is open.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const at = e.target instanceof Element ? e.target : null
      if (!at || box.current?.contains(at) || at.closest('.lib-row, [role="menu"], dialog') || document.querySelector('dialog[open]')) return
      dismiss()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [dismiss])
  const [links, setLinks] = useState<Read>('loading')
  const [failed, setFailed] = useState<string[]>([])
  const linkKey = `${r.key}\u0000${r.reviewState}\u0000${r.ci}\u0000${r.headSha}\u0000${r.reviewDraft}`
  const readLinks = useCallback(() => {
    if (!r.forge) return setLinks({ reviewUrl: null, pipelineUrl: null, issueUrl: null })
    setLinks('loading')
    api.links(r).then(setLinks, (err: unknown) => setLinks({ error: errorMessage(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey])
  useEffect(readLinks, [readLinks])
  // A red CI: the jobs that failed, named.
  useEffect(() => {
    setFailed([])
    if (r.ci !== 'fail' || !r.forge) return
    let live = true
    api.jobs(r).then(
      ({ jobs }) => live && setFailed(jobs.filter((j) => /fail/i.test(j.status)).map((j) => (j.stage ? `${j.stage} · ${j.name}` : j.name))),
      () => undefined,
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey])

  const read = links !== 'loading' && !('error' in links) ? links : null
  const showJobs = async (el: HTMLElement) => {
    try {
      const { jobs } = await api.jobs(r)
      const manual = jobs.filter((j) => j.manual)
      jobsMenu(
        el,
        manual.length
          ? manual.map((j) => ({ label: `${j.stage ? `${j.stage} · ` : ''}${j.name}…`, run: () => play(j) }))
          : [{ label: `Aucun job manuel sur le pipeline de ${r.name}`, run: () => undefined, disabled: true }],
      )
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    }
  }

  const current = r.task ? `${r.task.ref ? `${r.task.ref} · ` : ''}${r.task.title}` : r.taskId ? `Tâche inconnue · ${r.taskId.slice(0, 6)}` : ''
  return (
    // As the Kanban's panel of the branches without a task: at the window's right edge, its head, its body that
    // scrolls, its keys at the foot.
    <aside
      ref={box}
      className="lib-drawer"
      aria-labelledby="lib-drawer-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          close()
        }
      }}
    >
      <header className="lib-drawer-head">
        <div className="row">
          <h2 id="lib-drawer-title" className="grow mono selectable">
            {r.name}
          </h2>
          <button type="button" className="icon-btn" aria-label={`Plus d’actions pour ${r.name}`} title="Plus d’actions" onClick={(e) => menu(e.currentTarget)}>
            ⋯
          </button>
          <button type="button" className="icon-btn" aria-label="Fermer (Échap)" title="Fermer (Échap)" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="legend">
          {r.repoLabel} · dernier commit il y a {relTime(r.lastCommitAt)}
        </p>
      </header>

      <div className="lib-drawer-body">
        <ol className="lib-steps" aria-label="Étapes de la branche">
          {r.steps.map((st) => (
            <li key={st.id} className={`lib-step ${st.state}`} aria-current={st.state === 'current' ? 'step' : undefined}>
              <span className="lib-step-track" aria-hidden="true">
                <span className="lib-step-mark" />
              </span>
              <span className="lib-step-label">
                {st.label}
                <span className="sr-only">{st.state === 'done' ? ', faite' : st.state === 'current' ? ', en cours' : ', à venir'}</span>
              </span>
            </li>
          ))}
        </ol>

        <dl className="lib-facts">
          <div>
            <dt>Revue</dt>
            <dd>{r.reviewLabel ? `${r.reviewLabel}${r.reviewState === 'closed' ? ' fermée' : r.reviewDraft ? ', brouillon' : ''}` : 'aucune'}</dd>
          </div>
          <div>
            <dt>CI</dt>
            <dd className="lib-ci" data-ci={r.ci ?? 'none'}>
              {r.ci === 'fail' ? 'rouge' : r.ci === 'ok' ? 'verte' : r.ci === 'pending' ? 'en cours' : 'pas encore'}
            </dd>
          </div>
          <div>
            <dt>Origin</dt>
            <dd data-warn={!r.pushed}>{r.pushed ? 'à jour' : 'à pousser'}</dd>
          </div>
        </dl>

        <div className="row lib-task">
          <TaskPicker label="Tâche" tasks={tasks} done={done} branches={branches} current={current} noSource={noSource} picked={link} />
          {r.taskId && (
            <button type="button" className="btn" onClick={() => link(null)}>
              Délier
            </button>
          )}
        </div>

        {/* The one thing to do now, and its main action. */}
        <section className="lib-next" aria-labelledby="lib-next-title">
          <NextStep
            row={r}
            repo={repo}
            links={links}
            failed={failed}
            busy={busy}
            retryRead={readLinks}
            push={push}
            createReview={createReview}
            ready={ready}
            merge={merge}
            retry={retry}
            setTarget={setTarget}
          />
        </section>

        <div className="row lib-actions">
          {read?.reviewUrl && (
            <button type="button" className="btn lib-btn-sm" onClick={() => open(read.reviewUrl)}>
              Voir la {r.review}
            </button>
          )}
          {read?.pipelineUrl && (
            <button type="button" className="btn lib-btn-sm" onClick={() => open(read.pipelineUrl)}>
              Voir le pipeline
            </button>
          )}
          {read?.issueUrl && (
            <button type="button" className="btn lib-btn-sm" onClick={() => open(read.issueUrl)}>
              Voir l'issue{r.issueNumber ? ` #${r.issueNumber}` : ''}
            </button>
          )}
          {r.forge && (
            <button type="button" className="btn lib-btn-sm" disabled={busy} onClick={run}>
              Lancer un pipeline…
            </button>
          )}
          {read?.pipelineUrl && (
            <button type="button" className="btn lib-btn-sm" aria-haspopup="menu" onClick={(e) => void showJobs(e.currentTarget)}>
              Jobs manuels ▾
            </button>
          )}
        </div>
      </div>
      {!narrow && (
        <footer className="lib-drawer-foot legend">
          <span>
            <kbd>↑ ↓</kbd> autre branche
          </span>
          <span>
            <kbd>Menu</kbd> actions
          </span>
          <span>
            <kbd>Échap</kbd> fermer
          </span>
        </footer>
      )}
    </aside>
  )
}

function NextStep({
  row: r,
  repo,
  links,
  failed,
  busy,
  retryRead,
  push,
  createReview,
  ready,
  merge,
  retry,
  setTarget,
}: {
  row: Row
  repo: RepoView
  links: Read
  failed: string[]
  busy: boolean
  retryRead: () => void
  push: () => void
  createReview: (target: string) => void
  ready: () => void
  merge: () => void
  retry: () => void
  setTarget: (target: string) => void
}) {
  const title = (text: string, legend?: string) => (
    <div className="lib-next-text">
      <h3 id="lib-next-title" className="baloo">
        {text}
      </h3>
      {legend && <span className="legend">{legend}</span>}
    </div>
  )
  // The forge read for this branch: while it reads, and when it failed (with Réessayer).
  const forgeState =
    links === 'loading' ? (
      <span className="legend" role="status">
        Lecture de la forge…
      </span>
    ) : 'error' in links ? (
      <div className="row lib-alert" role="alert">
        <span className="grow">
          {r.forgeName} n’a pas pu être lu : {links.error}
        </span>
        <button type="button" className="btn lib-btn-sm" onClick={retryRead}>
          Réessayer
        </button>
      </div>
    ) : null
  const label = r.reviewLabel ?? r.review
  switch (r.step) {
    case 'task':
      return title('Lier à une tâche', 'Choisis-la dans le champ Tâche : son temps comptera pour elle dans Temps.')
    case 'review': {
      if (!r.forge) return title('Revue hors de l’app', 'Ce dépôt n’est ni sur GitHub ni sur GitLab (ou sa forge n’a pas de jeton) : pas de revue ni de CI ici.')
      if (r.reviewState === 'closed') return title(`${label} fermée sans fusion`, 'Rouvre-la sur la forge pour reprendre la revue.')
      return (
        <>
          {title(
            r.pushed ? `Créer la ${r.review} brouillon` : `Pousser, puis ouvrir la ${r.review}`,
            r.pushed
              ? 'Vers la branche cible, retenue pour ce dépôt.'
              : `La branche n’est pas encore sur origin au même commit, et la ${r.review} a besoin d’elle sur la forge.`,
          )}
          {!r.pushed && (
            <div className="row lib-next-actions">
              <button type="button" className="btn-cta" disabled={busy} onClick={push}>
                Pousser la branche…
              </button>
            </div>
          )}
          <div className="row lib-next-actions">
            {repo.targets.length ? (
              <>
                <label className="field lib-target">
                  Branche cible
                  <select value={repo.target ?? ''} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">à choisir</option>
                    {repo.targets.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="grow" />
                <button
                  type="button"
                  className={r.pushed ? 'btn-cta' : 'btn'}
                  disabled={!repo.target || !r.pushed || busy}
                  title={!r.pushed ? 'Pousse d’abord la branche' : !repo.target ? 'Choisis la branche cible' : undefined}
                  onClick={() => repo.target && createReview(repo.target)}
                >
                  Créer la {r.review} brouillon…
                </button>
              </>
            ) : (
              <span className="legend">Aucune branche cible trouvée dans ce dépôt.</span>
            )}
          </div>
        </>
      )
    }
    case 'ci':
      return (
        <>
          {title(
            r.ci === 'fail' ? `La CI de la ${label} est rouge` : 'Pipeline en cours',
            r.ci === 'fail' ? `La ${label} attend une CI qui passe.` : 'La page suit son avancement.',
          )}
          {failed.length > 0 && (
            <ul className="lib-failed" aria-label="Jobs en échec">
              {failed.map((j) => (
                <li key={j} className="mono">
                  {j}
                </li>
              ))}
            </ul>
          )}
          {forgeState}
          {r.ci === 'fail' && (
            <div className="row lib-next-actions">
              <button type="button" className="btn-cta" disabled={busy} onClick={retry}>
                Relancer les jobs en échec…
              </button>
            </div>
          )}
        </>
      )
    case 'merge':
      if (r.reviewDraft === true)
        return (
          <>
            {title(`Sortir la ${label} du brouillon`, `La CI passe. Une ${r.review} en brouillon ne se fusionne pas : sors-la du brouillon pour qu’elle soit relue.`)}
            <div className="row lib-next-actions">
              <button type="button" className="btn-cta" disabled={busy} onClick={ready}>
                Sortir du brouillon…
              </button>
            </div>
          </>
        )
      if (r.reviewDraft === false)
        return (
          <>
            {title(`Fusionner la ${label}`, `Relue et CI verte : elle va dans sa branche cible sur ${r.forgeName}.`)}
            <div className="row lib-next-actions">
              <button type="button" className="btn-cta" disabled={busy} onClick={merge}>
                Fusionner la {r.review}…
              </button>
            </div>
          </>
        )
      return (
        <>
          {title('Revue ouverte', `${label} : son état n’est pas encore lu.`)}
          {forgeState}
        </>
      )
    default:
      return title('Fusionnée', `${label} est fusionnée.`)
  }
}
