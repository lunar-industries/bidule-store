import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useOn } from '@bidule/sdk'
import type { ContainerDetail, LogsEvent } from '../contract.ts'
import { copy, openTerminal } from './actions.tsx'
import { api, message } from './api.ts'
import { fold, followLogs, highlight, logsText, NO_LOGS, parseLine, type LogCursor, type LogLevel, type LogLine } from './format.ts'
import { Icon } from './Icon.tsx'

// The logs kept on the view: the oldest go as new ones come.
const KEPT_LINES = 2000
// The messages of the logs kept until the API says which follow is the view's.
const EARLY_KEPT = 50
// How close to the bottom the view counts as at the end (a line or so).
const AT_END = 24

// Where the follow is: asked, under way, stopped by the engine (`ended`), or refused.
type Status = { kind: 'reading' } | { kind: 'live' } | { kind: 'ended' } | { kind: 'failed'; error: string }

/**
 * A container's logs: the last lines, then each new one, followed by the engine while `on` (their tab shows) and
 * pushed by the API (`docker.logs`). Followed again when the container starts or restarts (a new start time), and when
 * the user asks after the engine stopped following.
 */
export type Logs = { lines: LogLine[]; status: Status; retry: () => void }

export function useLogs(c: ContainerDetail, on: boolean): Logs {
  const { engine, id } = c
  const [lines, setLines] = useState<LogLine[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'reading' })
  const [attempt, setAttempt] = useState(0)
  const last = useRef<LogCursor>(NO_LOGS)
  // The follow this view asked for (another view's lines are not its own), and what came before the API said which
  // one it is: the first lines may come before its answer.
  const following = useRef<string | null>(null)
  const early = useRef<LogsEvent[]>([])
  // Only what is new is kept: a line already shown (another view's follow, joined, read them too) comes once.
  const add = (raw: string[]) => {
    const next = followLogs(raw.map(parseLine), last.current)
    last.current = next.cursor
    if (next.fresh.length) setLines((now) => [...now, ...next.fresh].slice(-KEPT_LINES))
  }
  const take = (event: LogsEvent) => {
    add(event.lines)
    if (event.ended) {
      following.current = null
      setStatus({ kind: 'ended' })
    }
  }
  useOn('docker.logs', (event) => {
    if (event.follow === following.current) take(event)
    else if (!following.current) early.current = [...early.current, event].slice(-EARLY_KEPT)
  })
  useEffect(() => {
    last.current = NO_LOGS
    setLines([])
  }, [engine, id])
  const running = c.state === 'running'
  const startedAt = c.startedAt
  useEffect(() => {
    if (!on) return
    let live = true
    let mine: string | null = null
    early.current = []
    setStatus({ kind: 'reading' })
    api.logs.follow({ params: { engine, id } }).then(
      ({ follow: given, lines: read }) => {
        if (!live) return void api.unfollow({ params: { follow: given } }).catch(() => undefined)
        mine = given
        following.current = given
        setStatus({ kind: 'live' })
        add(read)
        for (const e of early.current) if (e.follow === given) take(e)
        early.current = []
      },
      (err) => live && setStatus({ kind: 'failed', error: message(err) }),
    )
    return () => {
      live = false
      following.current = null
      if (mine) void api.unfollow({ params: { follow: mine } }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, engine, id, running, startedAt, attempt])
  return { lines, status, retry: () => setAttempt((n) => n + 1) }
}

type Level = 'all' | LogLevel

/**
 * The logs' tab (maquette « La fiche d'un conteneur »): the whole height of the view, a toolbar with the search (its
 * results marked and counted, Enter and Shift+Enter or ↑ ↓ to go from one to the next), the levels, « Suivre la fin »
 * (unticked when the user scrolls up, ticked again at the bottom), copying and saving what is shown, and the logs in
 * the Terminal.
 */
export function LogsPanel({
  c,
  logs: { lines, status, retry },
  terminal,
  tabs,
}: {
  c: ContainerDetail
  logs: Logs
  terminal: boolean
  tabs: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<Level>('all')
  const [follow, setFollow] = useState(true)
  const [hit, setHit] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const errors = lines.filter((l) => l.level === 'error').length
  const warnings = lines.filter((l) => l.level === 'warn').length
  const shown = level === 'all' ? lines : lines.filter((l) => l.level === level)
  const q = fold(query.trim())
  const hits = q ? shown.flatMap((l, i) => (fold(l.text).includes(q) ? [i] : [])) : []
  const current = hits.length ? Math.min(hit, hits.length - 1) : -1

  // The end stays in view while « Suivre la fin » is ticked, even once the oldest lines go.
  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, level, follow])
  const onScroll = () => {
    const el = box.current
    if (!el) return
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < AT_END
    if (atEnd !== follow) setFollow(atEnd)
  }
  // The result gone to, in view.
  const goTo = (at: number) => {
    if (!hits.length) return
    const next = (at + hits.length) % hits.length
    setHit(next)
    setFollow(false)
    box.current?.querySelector(`[data-line="${hits[next]}"]`)?.scrollIntoView({ block: 'center' })
  }

  // Ctrl+F (⌘F) goes to the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = window.bidule?.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        search.current?.focus()
        search.current?.select()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const save = () => {
    const url = URL.createObjectURL(new Blob([logsText(shown)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${c.name}.log`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const levels: { key: Level; label: string; count?: number }[] = [
    { key: 'all', label: 'Tout' },
    { key: 'error', label: 'Erreurs', count: errors },
    { key: 'warn', label: 'Avertissements', count: warnings },
  ]
  // What the box says when it shows no line: why.
  const none =
    status.kind === 'failed'
      ? `Impossible de lire le journal : ${status.error}`
      : status.kind === 'reading'
        ? 'Lecture du journal…'
        : level !== 'all' && lines.length
          ? `Aucune ligne de ce niveau parmi les ${lines.length} lues.`
          : c.state === 'created'
            ? 'Ce conteneur n’a jamais démarré : son journal est vide.'
            : 'Le journal est vide pour le moment.'
  return (
    <>
      <div className="lic-toolbar">
        {tabs}
        <label className="lic-log-search">
          <Icon name="search" size={14} />
          <input
            ref={search}
            type="search"
            aria-label="Chercher dans le journal"
            placeholder="Chercher…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHit(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                goTo(current + (e.shiftKey ? -1 : 1))
              } else if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
          {q && (
            <>
              <span className="lic-log-count" aria-live="polite">
                {hits.length ? `${current + 1} sur ${hits.length}` : 'aucun'}
              </span>
              <button type="button" className="lic-log-step" aria-label="Résultat précédent" title="Résultat précédent (Maj+Entrée)" disabled={!hits.length} onClick={() => goTo(current - 1)}>
                ↑
              </button>
              <button type="button" className="lic-log-step" aria-label="Résultat suivant" title="Résultat suivant (Entrée)" disabled={!hits.length} onClick={() => goTo(current + 1)}>
                ↓
              </button>
            </>
          )}
        </label>
        <div className="lic-levels" role="group" aria-label="Niveaux">
          {levels.map((l) => (
            <button key={l.key} type="button" className={`chip-btn lic-level-${l.key}`} aria-pressed={level === l.key} onClick={() => {
                setLevel(l.key)
                setHit(0)
              }}>
              {l.label}
              {l.count !== undefined && <span className="lic-level-count">{l.count}</span>}
            </button>
          ))}
        </div>
        <span className="grow" />
        <label className="row lic-check">
          <input type="checkbox" checked={follow} onChange={() => setFollow(!follow)} />
          Suivre la fin
        </label>
        <button type="button" className="icon-btn" aria-label="Copier le journal" title="Copier le journal" disabled={!shown.length} onClick={() => void copy(logsText(shown), 'Journal copié')}>
          <Icon name="copy" size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Enregistrer le journal" title="Enregistrer le journal…" disabled={!shown.length} onClick={save}>
          <Icon name="save" size={16} />
        </button>
        {terminal && (
          <button type="button" className="chip-btn" onClick={() => void openTerminal(c, 'logs')}>
            Ouvrir dans le Terminal
          </button>
        )}
      </div>
      {status.kind === 'ended' && (
        <div className="lic-notice" role="status">
          {c.state === 'running' ? 'Le suivi du journal s’est interrompu.' : 'Le conteneur est arrêté : son journal ne bouge plus.'}
          {c.state === 'running' && (
            <button type="button" className="btn" onClick={retry}>
              Reprendre le suivi
            </button>
          )}
        </div>
      )}
      <div ref={box} className="mono lic-logs" role="log" aria-label={`Journal de ${c.name}`} onScroll={onScroll}>
        {shown.map((l, i) => (
          <div key={i} data-line={i} className={`lic-log${l.level ? ` ${l.level}` : ''}${hits[current] === i ? ' current' : ''}`}>
            {l.time && <span className="lic-log-time">{l.time}</span>}
            {highlight(l.text, q).map((part, j) => (part.hit ? <mark key={j}>{part.text}</mark> : part.text))}
          </div>
        ))}
        {!shown.length && (
          <p className={`legend lic-logs-none${status.kind === 'failed' ? ' bad' : ''}`}>
            {none}
            {status.kind === 'failed' && (
              <button type="button" className="btn" onClick={retry}>
                Réessayer
              </button>
            )}
          </p>
        )}
      </div>
    </>
  )
}
