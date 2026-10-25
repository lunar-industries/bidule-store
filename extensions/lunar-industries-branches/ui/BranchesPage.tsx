import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { SpaceTools, busy, errorMessage, navigate, react, ToolFilter, ToolSearch, useOn, type Task } from '@bidule/sdk'
import { confirm, type Ask } from '@bidule/ext-lunar-industries-common/ui/confirm'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import { isMenuKey, useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import { SidePanel, type CloseReason } from '@bidule/ext-lunar-industries-common/ui/panel'
import { Alert, Empty, Loading } from '@bidule/ext-lunar-industries-common/ui/states'
import { TaskField, useTaskBoard, type TaskProblem } from '@bidule/ext-lunar-industries-common/ui/tasks'
import type { Job, Links, Listing } from '../contract.ts'
import { api } from './api.ts'
import { setOpened, useOpened } from './state.ts'
import { countsOf, FILTERS, relTime, reposOf, type Filter, type RepoView, type Row, type Sort } from './steps.ts'

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
  const taskBoard = useTaskBoard()
  const readTasks = taskBoard.retry
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
  const table = useRef<HTMLTableElement>(null)

  const reload = useCallback(() => {
    api.list().then(
      (l) => {
        setListing(l)
        setError(null)
      },
      (err: unknown) => setError(errorMessage(err)),
    )
  }, [])
  useEffect(reload, [reload])
  // The tasks read again with the branches, once they were read a first time (useTaskBoard does it).
  const reloadAll = useCallback(() => {
    reload()
    readTasks()
  }, [reload, readTasks])
  useOn('git.changed', reload)
  // The forges' reviews and CI read again, the tasks and the branches changed.
  useOn('objects.changed', ({ type }) => {
    if (type === 'task') reloadAll()
    else if (type === 'review' || type === 'pipeline' || type === 'branch') reload()
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

  const tasks = useMemo(() => taskBoard.tasks ?? [], [taskBoard.tasks])
  const repos = useMemo(() => (listing ? reposOf(listing, tasks, filter, sort, query) : []), [listing, tasks, filter, sort, query])
  const visible = repos.flatMap((r) => (folded.has(r.path) ? [] : r.rows))
  const all = repos.flatMap((r) => r.rows)
  const counts = listing ? countsOf(listing.branches) : null
  const openRow = all.find((r) => r.key === opened) ?? null
  const openRepo = openRow ? (repos.find((r) => r.path === openRow.repo) ?? null) : null
  const activeKey = active && visible.some((r) => r.key === active) ? active : (openRow?.key ?? visible[0]?.key ?? null)

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
        action:'Pousser',
      },
      () => api.push(r),
      `${r.name} poussée`,
    )
  const createReview = (r: Row, target: string) =>
    write(
      {
        title: `Créer la ${r.review} brouillon ?`,
        text: `Une ${r.review} brouillon de ${r.name} vers ${target} est ouverte sur ${r.forgeName}, intitulée « ${r.task?.title ?? r.name} ».`,
        action:`Créer la ${r.review}`,
      },
      () => api.review(r, target),
      `${r.review} brouillon ouverte pour ${r.name}`,
    )
  const ready = (r: Row) =>
    write(
      {
        title: `Sortir la ${r.reviewLabel ?? r.review} du brouillon ?`,
        text: `La ${r.reviewLabel ?? r.review} de ${r.name} devient prête à être relue sur ${r.forgeName}.`,
        action:'Sortir du brouillon',
      },
      () => api.ready(r),
      `${r.reviewLabel ?? r.review} prête à être relue`,
    )
  const merge = (r: Row) =>
    write(
      {
        title: `Fusionner la ${r.reviewLabel ?? r.review} ?`,
        text: `La ${r.reviewLabel ?? r.review} de ${r.name} est fusionnée dans sa branche cible sur ${r.forgeName}, comme son bouton là-bas. Cela ne se défait pas depuis l’app.`,
        action:'Fusionner',
      },
      () => api.merge(r),
      `${r.reviewLabel ?? r.review} fusionnée`,
    )
  const runPipeline = (r: Row) =>
    write(
      {
        title: `Lancer un pipeline sur ${r.name} ?`,
        text: `Un nouveau pipeline démarre sur ${r.forgeName} pour le dernier commit poussé de ${r.name}.`,
        action:'Lancer',
      },
      () => api.pipeline(r),
      `Pipeline lancé sur ${r.name}`,
    )
  const retry = (r: Row) =>
    write(
      {
        title: 'Relancer les jobs en échec ?',
        text: `Les jobs en échec du dernier pipeline de ${r.name} redémarrent sur ${r.forgeName}.`,
        action:'Relancer',
      },
      () => api.retry(r),
      `Jobs relancés sur ${r.name}`,
    )
  const play = (r: Row, job: Job) =>
    write(
      {
        title: `Lancer ${job.name} ?`,
        text: `Le job manuel ${job.stage ? `${job.stage} · ` : ''}${job.name} du pipeline de ${r.name} démarre sur ${r.forgeName}.`,
        action:'Lancer',
      },
      () => api.play(r, job.id),
      `${job.name} lancé`,
    )
  // A task added to the branch's, or taken off them: its other tasks stay.
  const link = async (r: Row, taskId: string, add: boolean) => {
    const others = r.taskIds.filter((id) => id !== taskId)
    try {
      await api.link(r, add ? [...others, taskId] : others)
      const title = tasks.find((x) => x.id === taskId)?.title ?? taskId
      if (add) react('quack', `Coin ! ${r.name} va avec « ${title} ».`, `${r.name} liée à ${title}`)
      else react('quack', `${r.name} ne va plus avec « ${title} »`, `${r.name} n'est plus liée à ${title}`)
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
    if (focusTask) setTimeout(() => document.querySelector<HTMLInputElement>('.lunar-panel .lunar-tasks input')?.focus())
  }
  // Closed by Escape or its ×, the drawer gives the focus back to the table (without scrolling it), on the row that
  // was open; closed by a click outside, the focus stays where that click put it.
  const close = (how: CloseReason = 'key') => {
    if (how !== 'outside' && opened) setActive(opened)
    setOpened(null)
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
    { label: r.taskId ? 'Ajouter une tâche…' : 'Lier à une tâche…', run: () => show(r, true) },
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
    <SpaceTools>
      <ToolSearch label="Chercher une branche" placeholder="Branche, dépôt, tâche…" value={query} onChange={setQuery} />
      <ToolFilter
        label="Branches affichées"
        options={FILTERS.map((f) => ({ ...f, count: counts?.[f.key] }))}
        value={filter}
        onChange={setFilter}
      />
    </SpaceTools>
  )

  if (!listing)
    return (
      <div className="page with-tools lib-page">
        {tools}
        {error ? (
          <Empty title="Les dépôts n’ont pas pu être lus." failed action={{ label: 'Réessayer', run: reloadAll }}>
            {error}
          </Empty>
        ) : (
          <Loading lines={6}>Lecture des dépôts…</Loading>
        )}
      </div>
    )
  if (!listing.repos.length && !listing.branches.length)
    return (
      <div className="page with-tools lib-page">
        {tools}
        <Empty title="Je ne vois aucun dépôt." action={{ label: 'Aller aux Réglages', run: () => navigate('/reglages/git') }}>
          Vérifie le dossier des dépôts dans les Réglages de git.
        </Empty>
      </div>
    )

  return (
    <div className={`page with-tools lib-page${narrow ? ' narrow' : ''}`}>
      {tools}
      {menu}
      <div className="lib-main">
        {error && <Alert retry={reloadAll}>Les branches n’ont pas pu être relues : {error} Voici la dernière lecture.</Alert>}
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
                          <span className="lib-chevron">
                            <Icon name="right" size={14} />
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
          query.trim() ? (
            <Empty title={`Aucune branche ne correspond à « ${query.trim()} ».`} action={{ label: 'Effacer la recherche', run: () => setQuery('') }}>
              La recherche porte sur le nom, le dépôt et la tâche.
            </Empty>
          ) : filter === 'orphans' ? (
            <Empty title="Chaque branche a sa tâche.">Coin !</Empty>
          ) : (
            <Empty
              title="Aucune branche en cours."
              action={counts && counts.all > 0 ? { label: `Voir toutes les branches (${counts.all})`, run: () => setFilter('all') } : undefined}
            />
          )
        )}
      </div>

      {openRow && openRepo && (
        <Drawer
          key={openRow.key}
          row={openRow}
          repo={openRepo}
          tasks={taskBoard.tasks}
          done={taskBoard.done}
          problem={taskBoard.problem}
          retryTasks={readTasks}
          branches={listing.branches}
          busy={writing}
          close={close}
          table={() => table.current}
          menu={(el) => openMenu(el, entriesFor(openRow), `Branche ${openRow.name}`)}
          jobsMenu={(el, entries) => openMenu(el, entries, 'Jobs manuels')}
          link={(id, add) => void link(openRow, id, add)}
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

const taskLabel = (t: Task) => `${t.ref ? `${t.ref} · ` : ''}${t.title}`

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
  // The tasks it serves besides the one shown.
  const more = Math.max(r.taskIds.length - 1, 0)
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
          <span className="legend lib-sub">
            {r.task ? `${r.task.ref ? `${r.task.ref} · ` : ''}${r.task.title}` : r.taskId ? 'Tâche inconnue' : 'aucune tâche'}
            {more > 0 && ` + ${more}`}
          </span>
        </span>
      </td>
      <td className="lib-col-task">
        {r.task ? (
          <span className="ellipsis" title={more > 0 ? r.tasks.map(taskLabel).join('\n') : undefined}>
            {r.task.ref && <span className="card-id">{r.task.ref} </span>}
            {r.task.title}
            {more > 0 && <span className="legend"> + {more} autre{more > 1 ? 's' : ''}</span>}
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
          className={writes && r.state.yours ? 'btn-cta lunar-btn-sm' : 'btn lunar-btn-sm'}
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
  problem,
  retryTasks,
  branches,
  busy,
  close,
  table,
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
  tasks: Task[] | null
  done: (task: Task) => boolean
  problem: TaskProblem | null
  retryTasks: () => void
  branches: Listing['branches']
  busy: boolean
  close: (how: CloseReason) => void
  // Where the focus goes back when the drawer closes by Escape or its ×.
  table: () => HTMLElement | null
  menu: (el: HTMLElement) => void
  jobsMenu: (el: HTMLElement, entries: MenuEntry[]) => void
  link: (taskId: string, add: boolean) => void
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

  return (
    // The common side panel, over the page: a click on a row of the table opens that row instead of closing it.
    <SidePanel
      title={r.name}
      mono
      subtitle={`${r.repoLabel} · dernier commit il y a ${relTime(r.lastCommitAt)}`}
      actions={
        <button type="button" className="icon-btn" aria-label={`Plus d’actions pour ${r.name}`} title="Plus d’actions" onClick={(e) => menu(e.currentTarget)}>
          <Icon name="more" />
        </button>
      }
      keys={[
        ['↑ ↓', 'autre branche'],
        ['Menu', 'actions'],
        ['Échap', 'fermer'],
      ]}
      keepOpenOn=".lib-row"
      returnFocus={table}
      onClose={close}
    >
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

        {r.taskIds.map((id) => {
          const task = r.tasks.find((t) => t.id === id)
          return (
            <div key={id} className="row lib-task">
              <span className="grow ellipsis">{task ? taskLabel(task) : `Tâche inconnue · ${id.slice(0, 6)}`}</span>
              <button type="button" className="btn" onClick={() => link(id, false)}>
                Délier
              </button>
            </div>
          )
        })}
        <div className="row lib-task">
          <TaskField
            label={r.taskIds.length ? 'Ajouter une tâche' : 'Tâche'}
            tasks={tasks}
            exclude={r.taskIds}
            done={done}
            problem={problem}
            retry={retryTasks}
            also={(t) => branches.filter((b) => b.taskIds.includes(t.id)).map((b) => b.name).join(' ')}
            onPick={(t) => link(t.id, true)}
          />
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
            <button type="button" className="btn lunar-btn-sm" onClick={() => open(read.reviewUrl)}>
              Voir la {r.review}
            </button>
          )}
          {read?.pipelineUrl && (
            <button type="button" className="btn lunar-btn-sm" onClick={() => open(read.pipelineUrl)}>
              Voir le pipeline
            </button>
          )}
          {read?.issueUrl && (
            <button type="button" className="btn lunar-btn-sm" onClick={() => open(read.issueUrl)}>
              Voir l'issue{r.issueNumber ? ` #${r.issueNumber}` : ''}
            </button>
          )}
          {r.forge && (
            <button type="button" className="btn lunar-btn-sm" disabled={busy} onClick={run}>
              Lancer un pipeline…
            </button>
          )}
          {read?.pipelineUrl && (
            <button type="button" className="btn lunar-btn-sm" aria-haspopup="menu" onClick={(e) => void showJobs(e.currentTarget)}>
              Jobs manuels <Icon name="down" size={14} />
            </button>
          )}
        </div>
    </SidePanel>
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
      <Loading>Lecture de la forge…</Loading>
    ) : 'error' in links ? (
      <Alert retry={retryRead}>
        {r.forgeName} n’a pas pu être lu : {links.error}
      </Alert>
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
