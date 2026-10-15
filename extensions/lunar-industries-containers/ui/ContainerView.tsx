import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useHint, useOn } from '@bidule/sdk'
import { useMenu } from '@bidule/ext-lunar-industries-common/ui/menu'
import type { ContainerDetail, ContainerHealth } from '../contract.ts'
import { act, containerEntries, copy, openTerminal } from './actions.tsx'
import { api, message } from './api.ts'
import { fmtBytes, fmtPercent, isFailed, isUp, portLabel, portsOf, portUrl, sinceOf, stateOf, titleOf, usageRowOf, when, type Tone } from './format.ts'
import { Icon } from './Icon.tsx'
import { LogsPanel, useLogs } from './Logs.tsx'
import { backToList, type Target } from './route.ts'
import { EnvironmentTab, FilesTab, ResourcesTab, type Samples } from './Tabs.tsx'
import { useUsage } from './usage.ts'

type Tab = 'logs' | 'resources' | 'env' | 'files'

// The measures drawn in the resources' tab, one every few seconds since the view was opened.
const KEPT_SAMPLES = 60
const NARROW = '(max-width: 1000px)'

const HEALTH: Record<ContainerHealth, { label: string; tone: Tone }> = {
  healthy: { label: 'sain', tone: 'ok' },
  starting: { label: 'vérification en cours', tone: 'warn' },
  unhealthy: { label: 'malade', tone: 'bad' },
}
const RESTART: Record<string, string> = {
  no: 'jamais',
  always: 'toujours',
  'unless-stopped': 'sauf arrêt manuel',
  'on-failure': 'après un échec',
}

const narrowQuery = () => matchMedia(NARROW)
function useNarrow(): boolean {
  return useSyncExternalStore(
    (l) => {
      const q = narrowQuery()
      q.addEventListener('change', l)
      return () => q.removeEventListener('change', l)
    },
    () => narrowQuery().matches,
  )
}

/**
 * A container's view (maquette « La fiche d'un conteneur »), at its own address (route.ts): read by its name, so that
 * it outlives a `docker compose up` that recreates it, and read again on the engines' events. Escape, Alt+← and the
 * mouse's back button go back to the list.
 */
export function ContainerView({ target }: { target: Target }) {
  const { engine, name } = target
  const [c, setC] = useState<ContainerDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = () =>
    api
      .show({ params: { engine, id: name } })
      .then((d) => {
        setC(d)
        setError(null)
      })
      .catch((err) => setError(message(err)))
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, name])
  useOn('docker.changed', () => void reload())

  // Back to the list: Escape (not in a field, a menu or a dialog), Alt+←, the mouse's back button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (document.querySelector('dialog[open], .menu')) return
        if (t?.closest('input, textarea, select, [contenteditable], .xterm')) return
        e.preventDefault()
        backToList()
      } else if (e.altKey && e.key === 'ArrowLeft' && !t?.closest('input, textarea, [contenteditable], .xterm')) {
        e.preventDefault()
        backToList()
      }
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3) return
      e.preventDefault()
      backToList()
    }
    addEventListener('keydown', onKey)
    addEventListener('mouseup', onMouse)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('mouseup', onMouse)
    }
  }, [])

  if (!c) {
    return (
      <div className="page">
        <Crumbs project={null} />
        {error ? (
          <div className="empty">
            <p>
              {name} n’a pas pu être lu : {error}. Il a peut-être été supprimé, ou son moteur ne répond pas.
            </p>
            <p className="row lic-empty-actions">
              <button type="button" className="btn" onClick={() => void reload()}>
                Réessayer
              </button>
              <button type="button" className="btn" onClick={backToList}>
                Retour aux conteneurs
              </button>
            </p>
          </div>
        ) : (
          <p className="muted lic-loading">Lecture de {name}…</p>
        )}
      </div>
    )
  }
  return <Fiche c={c} gone={error} />
}

// Where the view is: the list, then the project.
function Crumbs({ project }: { project: string | null }) {
  return (
    <nav className="lic-crumbs-head" aria-label="Fil d’Ariane">
      <button type="button" className="lic-back" title="Retour aux conteneurs (Échap)" onClick={backToList}>
        <Icon name="left" size={14} />
        Conteneurs
      </button>
      {project && (
        <>
          <span aria-hidden="true">/</span>
          <span>{project}</span>
        </>
      )}
      <span aria-hidden="true">/</span>
    </nav>
  )
}

function Fiche({ c, gone }: { c: ContainerDetail; gone: string | null }) {
  const [tab, setTab] = useState<Tab>('logs')
  const [working, setWorking] = useState(false)
  const [menu, openMenu] = useMenu()
  const terminal = Boolean(window.bidule?.terminal)
  const narrow = useNarrow()
  const logs = useLogs(c, tab === 'logs')
  const state = stateOf(c)
  const health = c.health ? HEALTH[c.health] : null
  const since = sinceOf(c)
  const ports = portsOf(c.ports)
  const firstPort = ports.find((p) => portUrl(c, p))

  useHint(
    c.state === 'running'
      ? `${titleOf(c)} tourne ${since || 'en ce moment'}${firstPort ? `, et répond sur le port ${firstPort.hostPort}` : ''}.`
      : isFailed(c)
        ? `${titleOf(c)} est tombé (${c.state === 'dead' ? 'mort' : `code ${c.exitCode}`}).`
        : `${titleOf(c)} est ${state.label}.`,
  )

  // What it uses: the current figures in the side panel, their history in the resources' tab.
  const usage = useUsage(c.state === 'running')
  const row = usage ? usageRowOf(usage.containers, c) : undefined
  const [samples, setSamples] = useState<Samples>({ cpu: [], memory: [], limit: 0 })
  const seen = useRef<object | null>(null)
  useEffect(() => {
    if (!row || !usage || seen.current === usage) return
    seen.current = usage
    setSamples((s) => ({
      cpu: [...s.cpu, row.cpu].slice(-KEPT_SAMPLES),
      memory: [...s.memory, row.memory].slice(-KEPT_SAMPLES),
      limit: row.limit,
    }))
  }, [usage, row])

  const run = async (action: 'start' | 'stop' | 'restart') => {
    if (working) return
    setWorking(true)
    try {
      await act(c, action)
    } finally {
      setWorking(false)
    }
  }

  const tabs: [Tab, string][] = [
    ['logs', 'Journaux'],
    ['resources', 'Ressources'],
    ...(c.env ? [['env', 'Environnement'] as [Tab, string]] : []),
    ['files', 'Fichiers'],
  ]
  const tabList = (
    <div className="segmented lic-tabs" role="tablist" aria-label="Contenu du conteneur">
      {tabs.map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
          {label}
        </button>
      ))}
    </div>
  )

  const info = (
    <dl className="lic-info">
      {ports.length > 0 && (
        <>
          <dt>Ports</dt>
          <dd className="lic-info-ports">
            {ports.map((p) => {
              const href = portUrl(c, p)
              return (
                <span key={`${p.hostPort}/${p.port}${p.protocol}`} className="lic-info-port">
                  {href ? (
                    <a className="mono lic-port live" href={href} target="_blank" rel="noreferrer" title={`Ouvrir ${href}`}>
                      {href.replace(/^http:\/\//, '')}
                    </a>
                  ) : (
                    <span className="mono lic-port">{portLabel(p)}</span>
                  )}
                  {href && (
                    <button type="button" className="icon-btn lic-copy" aria-label={`Copier ${href}`} title="Copier l’adresse" onClick={() => void copy(href, 'Adresse copiée')}>
                      <Icon name="copy" size={14} />
                    </button>
                  )}
                </span>
              )
            })}
          </dd>
        </>
      )}
      {health && (
        <>
          <dt>Santé</dt>
          <dd className={`lic-tone-${health.tone} lic-strong`}>{health.label}</dd>
        </>
      )}
      {c.restart && (
        <>
          <dt>Redémarrage</dt>
          <dd>
            {RESTART[c.restart.policy] ?? c.restart.policy}
            {c.restart.policy === 'on-failure' && c.restart.maxRetries ? ` (${c.restart.maxRetries} fois au plus)` : ''}
            {` · ${c.restart.count} fois`}
          </dd>
        </>
      )}
      {c.command && c.command.length > 0 && (
        <>
          <dt>Commande</dt>
          <dd className="mono selectable">{c.command.join(' ')}</dd>
        </>
      )}
      <dt>Image</dt>
      <dd className="mono selectable">{c.image}</dd>
      {c.mounts.length > 0 && (
        <>
          <dt>Volumes</dt>
          <dd className="lic-mounts">
            {c.mounts.map((m) => (
              <span key={m.destination} className="mono selectable" title={m.source}>
                {m.name ?? m.source} → {m.destination}
              </span>
            ))}
          </dd>
        </>
      )}
      {c.networks.length > 0 && (
        <>
          <dt>Réseau</dt>
          <dd className="mono">{c.networks.join(', ')}</dd>
        </>
      )}
      {c.env && (
        <>
          <dt>Environnement</dt>
          <dd>
            <button type="button" className="lic-link" onClick={() => setTab('env')}>
              {c.env.length} variable{c.env.length > 1 ? 's' : ''}
            </button>
          </dd>
        </>
      )}
      <dt>Identifiant</dt>
      <dd className="lic-info-id">
        <span className="mono">{c.id.slice(0, 12)}</span>
        <button type="button" className="icon-btn lic-copy" aria-label="Copier l’identifiant" title="Copier l’identifiant" onClick={() => void copy(c.id, 'Identifiant copié')}>
          <Icon name="copy" size={14} />
        </button>
      </dd>
      <dt>Créé</dt>
      <dd>{when(c.createdAt)}</dd>
    </dl>
  )
  const meters = c.state === 'running' && (
    <div className="lic-meters">
      {[
        { name: 'Processeur', value: row ? fmtPercent(row.cpu) : '—', width: row ? Math.min(100, row.cpu) : 0 },
        {
          name: 'Mémoire',
          value: row ? `${fmtBytes(row.memory)} sur ${fmtBytes(row.limit)}` : '—',
          width: row && row.limit ? Math.min(100, (row.memory / row.limit) * 100) : 0,
        },
      ].map((m) => (
        <div key={m.name} className="lic-meter-block">
          <div className="lic-meter-head">
            <span className="legend">{m.name}</span>
            <span className="mono">{m.value}</span>
          </div>
          <div className="lic-meter" role="img" aria-label={`${m.name} : ${m.value}`}>
            <div className="lic-meter-fill" style={{ width: `${Math.max(row ? 1 : 0, m.width)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="page fill lic-fiche">
      <header className="lic-fiche-head">
        <Crumbs project={c.project} />
        <h1 className="mono lic-fiche-name" title={c.name}>
          {titleOf(c)}
        </h1>
        <span className={`lic-pill lic-tone-${health?.tone === 'bad' ? 'bad' : state.tone}`}>
          {state.label}
          {health && c.state === 'running' ? ` · ${health.label}` : ''}
        </span>
        <span className="legend ellipsis lic-fiche-sub">
          {[c.project && c.service ? c.name : null, c.image, since].filter(Boolean).join(' · ')}
        </span>
        <span className="grow" />
        <span className="lic-fiche-actions">
          {terminal && (
            <button type="button" className="chip-btn" disabled={c.state !== 'running'} title={c.state === 'running' ? undefined : 'Le shell s’ouvre dans un conteneur en marche'} onClick={() => void openTerminal(c, 'shell')}>
              <Icon name="terminal" size={16} />
              Ouvrir un shell
            </button>
          )}
          {isUp(c) ? (
            <>
              <button type="button" className="chip-btn" disabled={working} onClick={() => void run('restart')}>
                <Icon name="restart" size={16} />
                Redémarrer
              </button>
              <button type="button" className="chip-btn" disabled={working} onClick={() => void run('stop')}>
                <Icon name="stop" size={16} />
                Arrêter
              </button>
            </>
          ) : (
            <button type="button" className="chip-btn lic-start" disabled={working} onClick={() => void run('start')}>
              <Icon name="play" size={16} />
              Démarrer
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Plus d’actions pour ${c.name}`}
            title="Plus d’actions"
            aria-haspopup="menu"
            onClick={(e) => openMenu(e.currentTarget, containerEntries(c, { terminal, removed: backToList }), `Actions sur ${c.name}`)}
          >
            <Icon name="more" size={18} />
          </button>
        </span>
      </header>
      {gone && <div className="lic-error" role="alert">{c.name} n’a pas pu être relu : {gone}</div>}

      <div className={`lic-fiche-body${narrow ? ' narrow' : ''}`}>
        {narrow && (
          <details className="panel lic-fiche-info">
            <summary>
              Informations
              <span className="legend">
                {[ports.length ? `${ports.length} port${ports.length > 1 ? 's' : ''}` : null, health?.label, `créé ${when(c.createdAt)}`].filter(Boolean).join(' · ')}
              </span>
            </summary>
            {info}
            {meters}
          </details>
        )}
        <section className="panel lic-fiche-main" aria-label="Contenu du conteneur">
          {tab === 'logs' ? (
            <LogsPanel c={c} logs={logs} terminal={terminal} tabs={tabList} />
          ) : (
            <>
              <div className="lic-toolbar">{tabList}</div>
              <div className="lic-tab-body">
                {tab === 'resources' && <ResourcesTab c={c} samples={samples} />}
                {tab === 'env' && c.env && <EnvironmentTab env={c.env} />}
                {tab === 'files' && <FilesTab c={c} />}
              </div>
            </>
          )}
        </section>
        {!narrow && (
          <aside className="panel lic-fiche-info" aria-label="Informations">
            <h2>Informations</h2>
            {info}
            {meters}
          </aside>
        )}
      </div>
      {menu}
    </div>
  )
}
