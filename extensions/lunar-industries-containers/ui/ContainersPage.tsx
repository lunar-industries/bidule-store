import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { BannerTools, ToolFilter, ToolSearch, useHint } from '@bidule/sdk'
import { useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import { allTicks, nextTicks, useListKeys } from '@bidule/ext-lunar-industries-common/ui/list'
import type { ContainerRow } from '../contract.ts'
import { act, actMany, containerEntries, copy, openTerminal, projectEntries, removeMany, tickedEntries } from './actions.tsx'
import { api } from './api.ts'
import { ContainerView } from './ContainerView.tsx'
import {
  fmtBytes,
  fmtPercent,
  fold,
  healthOf,
  isActive,
  isFailed,
  isUp,
  keyOf,
  looseHealthOf,
  portLabel,
  portsOf,
  portUrl,
  sinceOf,
  stateOf,
  tickKeyOf,
  titleOf,
  usageRowOf,
} from './format.ts'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import { Alert, Empty, Loading } from '@bidule/ext-lunar-industries-common/ui/states'
import { comeBack, leave, openContainer, useTarget, type Target } from './route.ts'
import { reloadContainers, useContainers } from './store.ts'
import { useUsage } from './usage.ts'
import './containers.css'

type Filter = 'active' | 'all'
// The containers of one Compose project; those outside any come last, together, folded and unfolded like a project.
type Group = { key: string; project: boolean; name: string; all: ContainerRow[]; rows: ContainerRow[] }
const OUTSIDE = ''

// Kept while the app runs: the projects folded, the filter, and the row to give the focus back to coming back from a
// container's view.
const folded = new Set<string>()
let keptFilter: Filter = 'active'
let refocus: string | null = null
const focusOnReturn = (id: string) => {
  refocus = id
}

/**
 * The containers' page: the list, or a container's view when its address names one (route.ts). Leaving the page on a
 * view, the page shows it again when it comes back from its tab.
 */
export function ContainersPage() {
  const target = useTarget()
  const shown = useRef<Target | null>(target)
  useEffect(() => {
    shown.current = target
  })
  useEffect(() => {
    comeBack()
    return () => leave(shown.current)
  }, [])
  return target ? <ContainerView key={`${target.engine}:${target.name}`} target={target} /> : <ContainerList />
}

/**
 * The user's containers (Docker, Podman), by Compose project (maquette « Conteneurs Lunar »): each project's health
 * over all its containers and actions on it in its header; a line a container with its state, ports, what it uses and
 * actions in fixed places; « Actifs » keeps in view what runs and what needs a look (restarting, paused, failed).
 * Usable from the keyboard as a desktop app's list (useListKeys), with the shared menu, and several containers ticked
 * with Ctrl+click, Shift+click and Ctrl+A; the actions on the ticked ones open from a ticked row's menu. The ticks are
 * kept between launches, by project and service (tickKeyOf).
 */
function ContainerList() {
  const { list, error } = useContainers()
  const [query, setQuery] = useState('')
  const [filter, setFilterState] = useState<Filter>(keptFilter)
  const setFilter = (f: Filter) => setFilterState((keptFilter = f))
  const [, setFoldTick] = useState(0)
  const [working, setWorking] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<string[] | null>(null)
  const anchor = useRef<string | null>(null)
  const [active, setActive] = useState<string | null>(refocus)
  const [menu, openMenu] = useMenu()
  const terminal = Boolean(window.bidule?.terminal)
  const all = list?.containers ?? []
  const usage = useUsage(all.some((c) => c.state === 'running'))

  useEffect(() => {
    void reloadContainers()
    void api.selection({}).then(
      ({ keys }) => setPicked(keys),
      () => setPicked([]),
    )
  }, [])

  // The ticks are saved as they change (once read: never the empty list of before).
  const saved = useRef(false)
  useEffect(() => {
    if (picked === null) return
    if (!saved.current) {
      saved.current = true
      return
    }
    void api.select({ body: { keys: picked } }).catch(() => undefined)
  }, [picked])

  const failed = all.filter(isFailed)
  const running = all.filter((c) => c.state === 'running').length
  useHint(
    !list
      ? null
      : !list.engines.length
        ? 'Ni Docker ni Podman en vue.'
        : failed.length
          ? `${failed
              .slice(0, 2)
              .map((c) => (c.project ? `${titleOf(c)} de ${c.project}` : c.name))
              .join(' et ')}${failed.length > 2 ? ` et ${failed.length - 2} autres` : ''} ${failed.length > 1 ? 'sont tombés' : 'est tombé'}.`
          : running
            ? `${running} conteneur${running > 1 ? 's' : ''} en marche sur ${all.length}.`
            : 'Tout dort.',
  )

  // The groups, over all the containers; their rows, those the filter and the search keep.
  const q = fold(query.trim())
  const matches = (c: ContainerRow) =>
    (filter === 'all' || isActive(c)) &&
    (!q || [c.name, c.image, c.project ?? '', c.service ?? '', ...c.ports.map((p) => String(p.hostPort ?? p.port))].some((s) => fold(s).includes(q)))
  const byKey = new Map<string, ContainerRow[]>()
  for (const c of all) byKey.set(c.project ?? OUTSIDE, [...(byKey.get(c.project ?? OUTSIDE) ?? []), c])
  const groups: Group[] = [...byKey.entries()]
    .map(([key, containers]) => ({
      key,
      project: key !== OUTSIDE,
      name: key || 'Sans projet',
      all: containers,
      rows: containers.filter(matches).sort((a, b) => titleOf(a).localeCompare(titleOf(b))),
    }))
    .filter((g) => g.rows.length)
    .sort((a, b) => (a.key === OUTSIDE ? 1 : b.key === OUTSIDE ? -1 : a.name.localeCompare(b.name)))
  // What is in view: a row hidden by the search, the filter or a folded project keeps its tick, but the actions on the
  // ticked ones leave it alone, so that nothing is done to what the user cannot see.
  const visible = groups.flatMap((g) => (folded.has(g.key) ? [] : g.rows))
  const ids = visible.map(keyOf)
  const byId = new Map(visible.map((c) => [keyOf(c), c]))

  // A service or a container gone leaves nothing behind in the ticks (saved with the next change); only when every
  // engine answered: one that does not would make its containers look gone.
  const live = list && !list.errors.length ? new Set(all.map(tickKeyOf)) : null
  const ticks = new Set((picked ?? []).filter((k) => !live || live.has(k)))
  const isTicked = (c: ContainerRow) => ticks.has(tickKeyOf(c))
  const ticked = visible.filter(isTicked)
  const setTicks = (next: Set<string>) => setPicked([...next])
  const untickAll = () => setTicks(new Set([...ticks].filter((k) => !visible.some((c) => tickKeyOf(c) === k))))
  const tickRow = (c: ContainerRow, shift: boolean) => {
    const result = nextTicks(ticks, visible.map(tickKeyOf), tickKeyOf(c), { shift, anchor: anchor.current })
    anchor.current = result.anchor
    setTicks(result.ticked)
  }
  const tickGroup = (g: Group, on: boolean) => {
    const keys = g.all.map(tickKeyOf)
    setTicks(on ? new Set([...ticks, ...keys]) : new Set([...ticks].filter((k) => !keys.includes(k))))
  }

  // One container at a time per row: its line waits while its action runs.
  const run = async (c: ContainerRow, action: 'start' | 'stop' | 'restart') => {
    const key = keyOf(c)
    if (working.has(key)) return
    setWorking((s) => new Set(s).add(key))
    try {
      await act(c, action)
    } finally {
      setWorking((s) => {
        const next = new Set(s)
        next.delete(key)
        return next
      })
    }
  }

  // Its view opens on its logs.
  const open = (c: ContainerRow) => {
    focusOnReturn(keyOf(c))
    openContainer({ engine: c.engine, name: c.name })
  }
  const keys = useListKeys({
    ids,
    active,
    setActive,
    onOpen: (id) => {
      const c = byId.get(id)
      if (c) open(c)
    },
    onToggle: (id) => {
      const c = byId.get(id)
      if (c) tickRow(c, false)
    },
    onDelete: (id) => {
      const c = byId.get(id)
      if (c) void removeMany(isTicked(c) && ticked.length > 1 ? ticked : [c])
    },
    onMenu: (id, e) => {
      const c = byId.get(id)
      if (c) openMenu(e, entriesFor(c), `Actions sur ${c.name}`)
    },
  })
  // Back from a container's view: the focus on its row again.
  useEffect(() => {
    if (!refocus || !byId.has(refocus)) return
    const id = refocus
    refocus = null
    keys.focus(id)
  })

  // A row's menu: the ticked containers' actions first when it is one of several ticked, then its own.
  const entriesFor = (c: ContainerRow): MenuEntry[] => [
    ...(isTicked(c) && ticked.length > 1 ? [...tickedEntries(ticked, untickAll), 'separator' as const] : []),
    ...containerEntries(c, { terminal, open: () => open(c), logs: () => open(c) }),
  ]

  // Ctrl+A (⌘A) ticks what is in view, Escape unticks it: on a row, not in a field.
  const onListKey = (e: KeyboardEvent) => {
    if (!(e.target instanceof HTMLElement) || !e.target.matches('.lic-row')) return
    const mod = window.bidule?.platform === 'darwin' ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setTicks(allTicks(ticks, visible.map(tickKeyOf)))
    } else if (e.key === 'Escape' && ticked.length) {
      e.preventDefault()
      untickAll()
    }
  }
  const onRowClick = (c: ContainerRow, e: MouseEvent) => {
    const mod = window.bidule?.platform === 'darwin' ? e.metaKey : e.ctrlKey
    if (mod || e.shiftKey) {
      e.preventDefault()
      tickRow(c, e.shiftKey)
    }
  }

  // What the running containers use of the machine, every engine together: one line in the list's header.
  const totals = (() => {
    if (!usage || !running) return null
    const cpu = usage.containers.reduce((sum, c) => sum + c.cpu, 0)
    const memory = usage.containers.reduce((sum, c) => sum + c.memory, 0)
    return {
      cpu: fmtPercent(usage.cpus ? cpu / usage.cpus : cpu),
      cpus: `${usage.cpus} cœur${usage.cpus > 1 ? 's' : ''}`,
      memory: fmtBytes(memory),
      memoryMax: fmtBytes(usage.memory),
    }
  })()

  const line = (c: ContainerRow, g: Group) => {
    const key = keyOf(c)
    const up = isUp(c)
    const doing = working.has(key)
    const state = stateOf(c)
    const since = sinceOf(c)
    const use = usage && c.state === 'running' ? usageRowOf(usage.containers, c) : undefined
    const cpu = use ? fmtPercent(use.cpu) : '—'
    const memory = use ? fmtBytes(use.memory) : '—'
    const detail = [g.project && c.service ? c.name : null, c.image, list && list.engines.length > 1 ? c.engine : null]
      .filter(Boolean)
      .join(' · ')
    return (
      <div
        key={key}
        role="listitem"
        aria-label={titleOf(c)}
        aria-busy={doing}
        className={`lic-row lic-tone-${state.tone}${isTicked(c) ? ' ticked' : ''}`}
        {...keys.rowProps(key)}
        onClick={(e) => onRowClick(c, e)}
        onDoubleClick={(e) => {
          if (!(e.target instanceof Element) || !e.target.closest('button, a, input')) open(c)
        }}
        onContextMenu={(e) => {
          setActive(key)
          openMenu(e, entriesFor(c), `Actions sur ${c.name}`)
        }}
      >
        <input
          type="checkbox"
          tabIndex={-1}
          checked={isTicked(c)}
          aria-label={`Cocher ${titleOf(c)}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            tickRow(c, e.shiftKey)
          }}
          onChange={() => undefined}
        />
        <span className="lic-name-cell">
          <span className={`lic-dot lic-tone-${state.tone}`} aria-hidden="true" />
          <span className="lic-names">
            <button type="button" tabIndex={-1} className="mono ellipsis lic-name" title={`Voir la fiche de ${c.name}`} onClick={() => open(c)}>
              {titleOf(c)}
            </button>
            <span className="legend ellipsis" title={detail}>
              {detail}
            </span>
          </span>
        </span>
        <span className="lic-ports">
          {portsOf(c.ports).map((p) => {
            const href = portUrl(c, p)
            const pkey = `${p.hostPort}/${p.port}${p.protocol}`
            const portMenu = (e: MouseEvent) => {
              e.stopPropagation()
              openMenu(
                e,
                [
                  href ? { label: 'Ouvrir', run: () => window.open(href, '_blank', 'noreferrer') } : null,
                  href ? { label: `Copier ${href.replace(/^http:\/\//, '')}`, run: () => copy(href, 'Adresse copiée') } : null,
                  p.hostPort ? { label: `Copier le port ${p.hostPort}`, run: () => copy(String(p.hostPort), 'Port copié') } : null,
                ],
                `Port ${portLabel(p)}`,
              )
            }
            return href ? (
              <a key={pkey} tabIndex={-1} className="mono lic-port live" href={href} target="_blank" rel="noreferrer" title={`Ouvrir ${href} · clic droit : copier`} onContextMenu={portMenu}>
                {portLabel(p)}
              </a>
            ) : (
              <span key={pkey} className="mono lic-port" onContextMenu={p.hostPort ? portMenu : undefined}>
                {portLabel(p)}
              </span>
            )
          })}
        </span>
        <span className="mono lic-cpu">{cpu}</span>
        <span className="mono lic-memory">{memory}</span>
        <span className="lic-state">
          <span className={`lic-state-label lic-tone-${state.tone}`}>{state.label}</span>
          {since && <span className="legend">{since}</span>}
          {use && <span className="mono legend lic-usage-narrow">{`${cpu} · ${memory}`}</span>}
        </span>
        <span className="lic-actions">
          {terminal && (
            <button
              type="button"
              tabIndex={-1}
              className="icon-btn lic-act-wide"
              aria-label={`Ouvrir un shell dans ${c.name}`}
              title={c.state === 'running' ? 'Ouvrir un shell' : 'Le shell s’ouvre dans un conteneur en marche'}
              disabled={c.state !== 'running'}
              onClick={() => void openTerminal(c, 'shell')}
            >
              <Icon name="terminal" size={18} />
            </button>
          )}
          <button type="button" tabIndex={-1} className="icon-btn lic-act-wide" aria-label={`Journaux de ${c.name}`} title="Voir les journaux" onClick={() => open(c)}>
            <Icon name="logs" size={18} />
          </button>
          {up ? (
            <button type="button" tabIndex={-1} className="icon-btn" aria-label={`Arrêter ${c.name}`} title="Arrêter" disabled={doing} onClick={() => void run(c, 'stop')}>
              <Icon name="stop" size={18} />
            </button>
          ) : (
            <button type="button" tabIndex={-1} className="icon-btn lic-start" aria-label={`Démarrer ${c.name}`} title="Démarrer" disabled={doing} onClick={() => void run(c, 'start')}>
              <Icon name="play" size={18} />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            className="icon-btn"
            aria-label={`Plus d’actions pour ${c.name}`}
            title="Plus d’actions"
            aria-haspopup="menu"
            onClick={(e) => {
              setActive(key)
              openMenu(e.currentTarget, entriesFor(c), `Actions sur ${c.name}`)
            }}
          >
            <Icon name="more" size={18} />
          </button>
        </span>
      </div>
    )
  }

  const group = (g: Group) => {
    const isFolded = folded.has(g.key)
    const health = g.project ? healthOf(g.all) : looseHealthOf(g.all)
    const down = g.all.filter((c) => !isUp(c))
    const up = g.all.filter(isUp)
    const allTicked = g.all.every(isTicked)
    const entries = () => projectEntries(g.all, { ticked: allTicked, tick: (on) => tickGroup(g, on) })
    const toggleFold = () => {
      if (!folded.delete(g.key)) folded.add(g.key)
      setFoldTick((n) => n + 1)
    }
    return (
      <section key={g.key || '-'} className="lic-group" aria-label={g.name}>
        <div className="lic-group-head" onContextMenu={g.project ? (e) => openMenu(e, entries(), `Actions sur ${g.name}`) : undefined}>
          <button type="button" className="icon-btn lic-fold" aria-expanded={!isFolded} aria-label={`${isFolded ? 'Déplier' : 'Replier'} ${g.name}`} onClick={toggleFold}>
            <Icon name={isFolded ? 'right' : 'down'} size={16} />
          </button>
          <h3 className="lic-group-name">{g.name}</h3>
          <span className={`lic-health lic-tone-${health.tone}`}>{health.label}</span>
          <span className="grow" />
          {g.project && (
            <span className="lic-group-actions">
              <button type="button" className="chip-btn" disabled={!down.length} onClick={() => void actMany(down, 'start')}>
                <Icon name="play" size={14} />
                Tout démarrer
              </button>
              <button type="button" className="icon-btn" aria-label={`Tout redémarrer dans ${g.name}`} title="Tout redémarrer" onClick={() => void actMany(g.all, 'restart')}>
                <Icon name="restart" size={18} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Tout arrêter dans ${g.name}`} title="Tout arrêter" disabled={!up.length} onClick={() => void actMany(up, 'stop')}>
                <Icon name="stop" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Plus d’actions pour ${g.name}`}
                title="Plus d’actions"
                aria-haspopup="menu"
                onClick={(e) => openMenu(e.currentTarget, entries(), `Actions sur ${g.name}`)}
              >
                <Icon name="more" size={18} />
              </button>
            </span>
          )}
        </div>
        {!isFolded && g.rows.map((c) => line(c, g))}
      </section>
    )
  }

  // Nothing in view: why, and what to do about it.
  const empty = () => {
    if (q) {
      return (
        <Empty title={`Aucun conteneur ne correspond à « ${query.trim()} ».`} action={{ label: 'Effacer la recherche', run: () => setQuery('') }}>
          La recherche porte sur le nom, l’image, le projet et les ports.
        </Empty>
      )
    }
    if (!all.length) return <Empty title={`Aucun conteneur sur ${list?.engines.map((e) => e.name).join(' ni ')}.`} />
    const projects = [...new Set(all.map((c) => c.project).filter((p): p is string => Boolean(p)))].slice(0, 3)
    return (
      <Empty
        title="Rien ne tourne."
        action={
          <div className="row lic-empty-actions">
            <button type="button" className="btn" onClick={() => setFilter('all')}>
              Afficher tous les conteneurs
            </button>
            {projects.map((p) => (
              <button key={p} type="button" className="btn" onClick={() => void actMany(all.filter((c) => c.project === p), 'start')}>
                Démarrer {p}
              </button>
            ))}
          </div>
        }
      >
        {all.length} conteneur{all.length > 1 ? 's sont arrêtés' : ' est arrêté'}.
      </Empty>
    )
  }

  const filters = [
    { key: 'active' as const, label: 'Actifs', count: all.filter(isActive).length },
    { key: 'all' as const, label: 'Tous', count: all.length },
  ]
  return (
    <div className="page with-tools">
      <BannerTools>
        <ToolSearch label="Chercher un conteneur" placeholder="Nom, image, projet, port…" value={query} onChange={setQuery} />
        <ToolFilter label="Conteneurs affichés" options={filters} value={filter} onChange={setFilter} />
      </BannerTools>

      {error && (
        <Alert retry={() => void reloadContainers()}>
          Les conteneurs n’ont pas pu être lus : {error}
          {list ? ' Voici la dernière lecture.' : ''}
        </Alert>
      )}
      {!list && !error && <Loading lines={5}>Lecture des conteneurs…</Loading>}
      {list && !list.engines.length && (
        <Empty title="Ni Docker ni Podman trouvés.">Installe l’un des deux : la page le trouvera d’elle-même.</Empty>
      )}

      {list && list.engines.length > 0 && (
        <>
          {list.errors.map((e) => (
            <Alert key={e.engine} retry={() => void reloadContainers()}>
              {e.engine} ne répond pas : {e.message}
            </Alert>
          ))}
          <section className="panel lic-list" aria-label="Conteneurs">
            <header className="lic-list-head">
              <h2>Conteneurs</h2>
              {ticked.length > 0 && (
                <button type="button" className="lic-ticked" title="Tout décocher (Échap)" onClick={untickAll}>
                  {ticked.length} coché{ticked.length > 1 ? 's' : ''}
                </button>
              )}
              <span className="grow" />
              {totals && (
                <span className="legend lic-totals">
                  Processeur <strong className="mono">{totals.cpu}</strong> des {totals.cpus}
                  <span aria-hidden="true"> · </span>
                  Mémoire <strong className="mono">{totals.memory}</strong> sur {totals.memoryMax}
                </span>
              )}
            </header>
            {groups.length > 0 && (
              <div className="lic-columns" aria-hidden="true">
                <span />
                <span>Service</span>
                <span>Ports</span>
                <span className="lic-cpu">Processeur</span>
                <span className="lic-memory">Mémoire</span>
                <span>État</span>
                <span className="lic-actions-title">Actions</span>
              </div>
            )}
            {groups.length ? (
              <div role="list" className="lic-groups" onKeyDown={onListKey}>
                {groups.map(group)}
              </div>
            ) : (
              empty()
            )}
          </section>
        </>
      )}
      {menu}
    </div>
  )
}
