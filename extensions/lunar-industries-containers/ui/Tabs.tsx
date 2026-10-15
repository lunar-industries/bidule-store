import { useEffect, useState } from 'react'
import type { ContainerDetail, ContainerFile } from '../contract.ts'
import { copy } from './actions.tsx'
import { api, message } from './api.ts'
import { chartPoints, chartTop, fmtBytes, fmtPercent, isSecretName } from './format.ts'
import { Icon } from './Icon.tsx'

// The view's tabs other than the logs: what it used since the view opened, its environment, its files.

export type Samples = { cpu: number[]; memory: number[]; limit: number }

/**
 * What it used, a measure every few seconds since the view opened: the processor on a scale of whole cores (one, or
 * as many as it went over), the memory on its limit. The current figures are in the side panel.
 */
export function ResourcesTab({ c, samples }: { c: ContainerDetail; samples: Samples }) {
  if (c.state !== 'running') return <p className="legend lic-tab-note">Les ressources se mesurent sur un conteneur en marche.</p>
  if (samples.cpu.length < 2)
    return <p className="legend lic-tab-note">Une mesure arrive toutes les quelques secondes : la courbe se dessine dès la deuxième.</p>
  const cpuTop = chartTop('cpu', samples.cpu, 0)
  const memoryTop = chartTop('memory', samples.memory, samples.limit)
  const charts = [
    { name: 'Processeur', points: chartPoints(samples.cpu, cpuTop), top: `${fmtPercent(cpuTop)} (${cpuTop / 100} cœur${cpuTop > 100 ? 's' : ''})` },
    { name: 'Mémoire', points: chartPoints(samples.memory, memoryTop), top: fmtBytes(memoryTop) },
  ]
  return (
    <div className="lic-charts">
      {charts.map((m) => (
        <figure key={m.name} className="lic-chart">
          <figcaption className="lic-chart-head">
            <h3>{m.name}</h3>
            <span className="legend">jusqu’à {m.top}</span>
          </figcaption>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${m.name} depuis l’ouverture de la fiche`}>
            <polygon className="lic-area" points={m.points.area} />
            <polyline className="lic-line" points={m.points.line} />
          </svg>
        </figure>
      ))}
      <p className="legend lic-tab-note">Depuis l’ouverture de cette fiche, une mesure toutes les quelques secondes.</p>
    </div>
  )
}

/**
 * Its environment, as the engine starts it. A value named like a secret (a password, a token) is hidden until asked:
 * the screen may be shared. Each line copies as `NAME=value`.
 */
export function EnvironmentTab({ env }: { env: { name: string; value: string }[] }) {
  const [shown, setShown] = useState<Set<string>>(new Set())
  if (!env.length) return <p className="legend lic-tab-note">Aucune variable d’environnement.</p>
  return (
    <dl className="lic-env">
      {env.map(({ name, value }) => {
        const hidden = isSecretName(name) && !shown.has(name)
        return (
          <div key={name} className="lic-env-row">
            <dt className="mono">{name}</dt>
            <dd className="mono selectable">{hidden ? '••••••••' : value || <span className="legend">(vide)</span>}</dd>
            <span className="lic-env-actions">
              {isSecretName(name) && (
                <button type="button" className="chip-btn" onClick={() => setShown((s) => (s.delete(name) ? new Set(s) : new Set(s).add(name)))}>
                  {hidden ? 'Afficher' : 'Masquer'}
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={`Copier ${name}`} title={`Copier ${name}=…`} onClick={() => void copy(`${name}=${value}`, 'Variable copiée')}>
                <Icon name="copy" size={14} />
              </button>
            </span>
          </div>
        )
      })}
    </dl>
  )
}

// The files inside it, a folder at a time, from its root; read only in a running container.
export function FilesTab({ c }: { c: ContainerDetail }) {
  const { engine, id } = c
  const [path, setPath] = useState('/')
  // The last folder read, and of which container: another one shown is still being read.
  const [read, setRead] = useState<{ at: string; files?: ContainerFile[]; error?: string } | null>(null)
  const running = c.state === 'running'
  const at = `${id}:${path}`
  useEffect(() => {
    if (!running) return
    let live = true
    api
      .files({ params: { engine, id }, query: { path } })
      .then((r) => live && setRead({ at, files: r.files }))
      .catch((err) => live && setRead({ at, error: message(err) }))
    return () => {
      live = false
    }
  }, [at, path, engine, id, running])
  const files = read?.at === at ? (read.files ?? null) : null
  const error = read?.at === at ? (read.error ?? null) : null
  if (!running) return <p className="legend lic-tab-note">Les fichiers se lisent dans un conteneur en marche.</p>
  const parts = path.split('/').filter(Boolean)
  const crumbs = parts.map((name, i) => ({ name, path: '/' + parts.slice(0, i + 1).join('/') }))
  const child = (name: string) => (path === '/' ? '' : path) + '/' + name
  return (
    <div className="lic-files-tab">
      <nav className="lic-crumbs" aria-label="Dossier affiché">
        <button type="button" className="chip-btn mono" onClick={() => setPath('/')}>
          /
        </button>
        {crumbs.map((b) => (
          <button key={b.path} type="button" className="chip-btn mono" onClick={() => setPath(b.path)}>
            {b.name}
          </button>
        ))}
        <span className="grow" />
        <button type="button" className="chip-btn" onClick={() => void copy(path, 'Chemin copié')}>
          <Icon name="copy" size={14} />
          Copier le chemin
        </button>
      </nav>
      {error ? (
        <p className="legend lic-tab-note bad">Impossible de lire {path} : {error}</p>
      ) : (
        <div className="mono lic-files">
          {path !== '/' && (
            <button type="button" className="lic-file dir" onClick={() => setPath('/' + parts.slice(0, -1).join('/'))}>
              ../
            </button>
          )}
          {files?.map((f) =>
            f.directory ? (
              <button key={f.name} type="button" className="lic-file dir" onClick={() => setPath(child(f.name))}>
                {f.name}/
              </button>
            ) : (
              <span key={f.name} className="lic-file">
                {f.name}
              </span>
            ),
          )}
          {files && !files.length && <p className="legend lic-tab-note">Dossier vide.</p>}
          {!files && <p className="legend lic-tab-note">Lecture…</p>}
        </div>
      )}
    </div>
  )
}
