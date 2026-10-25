import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  SpaceTools,
  errorMessage,
  navigate,
  react,
  ToolSearch,
  useHint,
  useSavedState,
} from '@bidule/sdk'
import { isMenuKey, useMenu, type MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import type { ClaudePlace, SessionStatus } from '../contract.ts'
import { api } from './api.ts'
import { Conversation } from './Conversation.tsx'
import { relTime, STATUS } from './events.ts'
import { Icon } from '@bidule/ext-lunar-industries-common/ui/icons'
import { Alert, Empty } from '@bidule/ext-lunar-industries-common/ui/states'
import { openNewSession } from './newSession.tsx'
import { SessionContext } from './SessionContext.tsx'
import {
  followSessions,
  refreshSessions,
  repoLabel,
  retrySessions,
  select,
  useBoard,
  useEnabled,
  useRepos,
  useSelected,
  useSessions,
  useSessionsError,
} from './state.ts'
import './claude.css'

// The list's groups: the one thing it has to surface is a session held up by a decision, the same one the tab counts.
// The rest sits together: a session of the terminal comes and goes without this app having anything to do about it.
const GROUPS: { label: string; statuses: SessionStatus[] }[] = [
  { label: 'En attente de toi', statuses: ['waiting'] },
  { label: 'Sessions', statuses: ['running', 'idle', 'saved'] },
]

// The side columns open or folded, and the archived shown: kept from one launch to the next (a hidden setting).
const COLUMNS = 'lunar-industries-claude.columns'
type Columns = { left: boolean; right: boolean; archived: boolean }
const OPEN: Columns = { left: true, right: true, archived: false }
function readColumns(raw: unknown): Columns | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { left, right, archived } = raw as Record<string, unknown>
  return typeof left === 'boolean' && typeof right === 'boolean' && typeof archived === 'boolean' ? { left, right, archived } : null
}

// Under this width the side columns fold by themselves, and the first visit stands in one column.
const NARROW = '(max-width: 1000px)'
const subscribeNarrow = (changed: () => void) => {
  const query = matchMedia(NARROW)
  query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches)

/**
 * Claude (Lunar Industries, Simon's pages/claude): Claude Code sessions run in the app. The list on the left
 * (grouped by state), the conversation, the session's context on the right. Each side column folds into a strip;
 * a narrow window folds both. Off until the experimental switch of its settings is on.
 */
export function ClaudePage() {
  const enabled = useEnabled()
  if (enabled === null) return <div className="page fill" />
  if (!enabled) return <Disabled />
  return <Sessions />
}

function Disabled() {
  useHint('Les sessions Claude dans l’app sont éteintes. Coin.')
  return (
    <div className="page">
      <section className="panel lc-off">
        <h2>Sessions Claude dans l’app</h2>
        <p className="muted">
          Ce module pilote Claude Code depuis l’application avec l’Agent SDK et ton compte Claude. Anthropic n’a pas
          explicitement approuvé cet usage d’un abonnement par une application tierce : il est éteint tant que tu ne
          l’allumes pas dans ses réglages.
        </p>
        <div className="row">
          <button type="button" className="btn-cta" onClick={() => navigate('/reglages/lunar-industries-claude')}>
            Ouvrir les réglages
          </button>
        </div>
      </section>
    </div>
  )
}

function Sessions() {
  const list = useSessions()
  const listError = useSessionsError()
  const repos = useRepos()
  const board = useBoard()
  const selectedId = useSelected()
  const [search, setSearch] = useState('')
  const [columns, setColumns] = useSavedState<Columns>(COLUMNS, OPEN, readColumns)
  const [menu, openMenu] = useMenu()

  // A narrow window: both columns folded. One unfolded by hand stays so until the page is wide again; the columns
  // kept for the wide page are untouched.
  const narrow = useNarrow()
  const compact = narrow
  const [unfolded, setUnfolded] = useState({ left: false, right: false })
  useEffect(() => {
    if (compact) setUnfolded({ left: false, right: false })
  }, [compact])
  const leftOpen = compact ? unfolded.left : columns.left
  const rightOpen = compact ? unfolded.right : columns.right
  const fold = (side: 'left' | 'right', open: boolean) =>
    compact ? setUnfolded((u) => ({ ...u, [side]: open })) : setColumns((c) => ({ ...c, [side]: open }))

  useEffect(followSessions, [])

  // ?session=<id> (a notification), ?task=<id> (the Kanban): that session, or a new one from that task.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const session = q.get('session')
    const task = q.get('task')
    if (session === null && task === null) return
    history.replaceState(null, '', location.pathname)
    if (session) select(session)
    if (task !== null) void newSession(task || null)
  }, [])

  const tasks = board?.tasks ?? []
  const all = (list ?? []).map((s) => {
    const known = tasks.find((t) => t.id === s.taskId)
    const task = s.task ?? (known ? { ref: known.ref, title: known.title } : null)
    const labels = s.repos.map((p) => repoLabel(repos, p))
    return {
      ...s,
      task,
      labels,
      url: known?.url ?? null,
      // No status here: only a decision awaited is worth naming, and the group already says it.
      meta: [task?.ref ?? (s.fromApp ? 'Sans tâche' : 'Terminal ou VS Code'), labels.join(', ')].filter(Boolean).join(' · '),
    }
  })
  const words = search.trim().toLowerCase()
  const visible = all.filter(
    (s) => !words || [s.title, s.task?.title, s.task?.ref, ...s.labels].some((v) => v?.toLowerCase().includes(words)),
  )
  const archivedCount = visible.filter((s) => s.archived).length
  const shown = visible.filter((s) => !s.archived || columns.archived)
  const groups = [
    ...GROUPS.map((g) => ({ label: g.label, items: visible.filter((s) => !s.archived && g.statuses.includes(s.status)) })),
    { label: 'Archivées', items: columns.archived ? visible.filter((s) => s.archived) : [] },
  ].filter((g) => g.items.length)
  const current = all.find((s) => s.id === selectedId) ?? all.find((s) => !s.archived) ?? null
  const waiting = all.filter((s) => !s.archived && s.status === 'waiting').length
  const working = all.some((s) => !s.archived && s.status === 'running')

  useHint(
    list === null
      ? null
      : waiting
        ? `${waiting} session${waiting > 1 ? 's attendent' : ' attend'} ta décision. Coin !`
        : working
          ? 'Claude bosse, je surveille. Coin.'
          : null,
  )

  async function newSession(taskId: string | null = null) {
    const id = await openNewSession({ taskId })
    if (!id) return
    select(id)
    refreshSessions()
  }

  // Only a stopped session is archived; archiving it again takes it back out.
  const archive = async (id: string, value: boolean) => {
    try {
      await api.archive(id, value)
      refreshSessions()
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    }
  }
  const copyId = async (id: string) => {
    await navigator.clipboard.writeText(id)
    react('quack', 'Identifiant copié, coin !', 'Identifiant de la session copié')
  }
  // A session's own actions: the « ⋯ » of its conversation, and its right click in the list.
  const entriesFor = (s: (typeof all)[number]): MenuEntry[] => [
    s.url ? { label: 'Ouvrir la tâche', run: () => s.url && window.open(s.url, '_blank', 'noopener') } : null,
    { label: 'Copier l’identifiant de la session', run: () => copyId(s.id) },
    'separator',
    {
      label: s.archived ? 'Désarchiver' : 'Archiver',
      run: () => archive(s.id, !s.archived),
      disabled: s.fromApp && s.status !== 'saved' ? 'Arrête d’abord la session pour l’archiver.' : false,
    },
  ]
  const titleOf = (s: (typeof all)[number]) => s.task?.title ?? s.title

  const tools = (
    <SpaceTools>
      <ToolSearch label="Chercher une session" placeholder="Session ou tâche…" value={search} onChange={setSearch} />
      <button type="button" className="banner-button" onClick={() => void newSession()}>
        Nouvelle session
      </button>
    </SpaceTools>
  )

  // The sessions could not be read at all: said, with Réessayer, never taken for a first visit.
  if (list === null && listError)
    return (
      <div className="page fill with-tools lc-page">
        {tools}
        <Empty title="Les sessions n’ont pas pu être lues." failed action={{ label: 'Réessayer', run: retrySessions }}>
          {listError}
        </Empty>
      </div>
    )

  // Nothing at all to show, sessions of the terminal included: the first visit.
  if (list !== null && !all.length) return <FirstVisit start={(id) => void newSession(id)} />

  return (
    <div className="page fill with-tools lc-page">
      {tools}
      {menu}
      {leftOpen ? (
        <section className="panel lc-list" aria-label="Sessions">
          <div className="row">
            <h2 className="grow">Sessions</h2>
            <button
              type="button"
              className="icon-btn lc-icon-sm"
              aria-label="Replier la liste des sessions"
              title="Replier la liste"
              onClick={() => fold('left', false)}
            >
              <Icon name="left" size={16} />
            </button>
          </div>
          {listError && <Alert retry={retrySessions}>Les sessions n’ont pas pu être relues : {listError}</Alert>}
          <div className="lc-groups" role="listbox" aria-label="Sessions">
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="lc-group">
                <div className="legend lc-group-title" aria-hidden="true">
                  {g.label}
                </div>
                {g.items.map((s) => (
                  <div
                    key={s.id}
                    role="option"
                    tabIndex={current?.id === s.id ? 0 : -1}
                    aria-selected={current?.id === s.id}
                    className="lc-item"
                    data-status={s.status}
                    onClick={() => select(s.id)}
                    onKeyDown={(e) => {
                      if (isMenuKey(e)) return openMenu(e, entriesFor(s), `Session ${titleOf(s)}`)
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        select(s.id)
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        const items = [...(e.currentTarget.closest('.lc-groups')?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
                        const at = items.indexOf(e.currentTarget)
                        const next = items[at + (e.key === 'ArrowDown' ? 1 : -1)]
                        next?.focus()
                        next?.click()
                      }
                    }}
                    onContextMenu={(e) => openMenu(e, entriesFor(s), `Session ${titleOf(s)}`)}
                  >
                    <span className="lc-item-text grow">
                      <strong className="ellipsis">{titleOf(s)}</strong>
                      <span className="legend ellipsis">{s.meta}</span>
                    </span>
                    <span className="legend lc-when">{relTime(s.updatedAt)}</span>
                  </div>
                ))}
              </div>
            ))}
            {!groups.length && <span className="legend">{list === null ? 'Lecture des sessions…' : 'Aucune session ne correspond.'}</span>}
          </div>
          {archivedCount > 0 && (
            <button
              type="button"
              className="chip-btn lc-archived"
              aria-pressed={columns.archived}
              onClick={() => setColumns((c) => ({ ...c, archived: !c.archived }))}
            >
              {columns.archived ? 'Masquer' : 'Afficher'} les archivées ({archivedCount})
            </button>
          )}
        </section>
      ) : (
        <nav className="panel lc-rail" aria-label="Sessions, repliées">
          <button
            type="button"
            className="icon-btn lc-icon-sm"
            aria-label="Déplier la liste des sessions"
            title="Déplier la liste"
            onClick={() => fold('left', true)}
          >
            <Icon name="right" size={16} />
          </button>
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              className="lc-rail-item"
              aria-pressed={current?.id === s.id}
              // Its state is in its name: the dot alone says nothing to a screen reader.
              aria-label={`${titleOf(s)}, ${STATUS[s.status].label}`}
              title={`${titleOf(s)} · ${STATUS[s.status].label}`}
              onClick={() => select(s.id)}
              onContextMenu={(e) => openMenu(e, entriesFor(s), `Session ${titleOf(s)}`)}
            >
              <span className="lc-dot" data-status={s.status} />
            </button>
          ))}
        </nav>
      )}

      {current ? (
        <>
          <Conversation
            session={current}
            heading={titleOf(current)}
            taskRef={current.task?.ref ?? null}
            repoLabels={current.labels}
            wide={!leftOpen && !rightOpen}
            narrow={narrow}
            moreEntries={entriesFor(current)}
          />
          {rightOpen ? (
            <SessionContext sessionId={current.id} cwd={current.cwd} collapse={() => fold('right', false)} />
          ) : (
            <nav className="panel lc-rail" aria-label="Contexte, replié">
              <button
                type="button"
                className="icon-btn lc-icon-sm"
                aria-label="Déplier le contexte"
                title="Déplier le contexte"
                onClick={() => fold('right', true)}
              >
                <Icon name="left" size={16} />
              </button>
            </nav>
          )}
        </>
      ) : (
        <section className="panel lc-none">
          <p className="legend">{list === null ? 'Lecture des sessions…' : 'Aucune session à afficher.'}</p>
          <button type="button" className="btn" onClick={() => void newSession()}>
            Nouvelle session
          </button>
        </section>
      )}
    </div>
  )
}

// First visit: what is needed (the Claude Code found), and the tasks in progress to start from.
function FirstVisit({ start }: { start: (taskId: string | null) => void }) {
  const board = useBoard()
  const [places, setPlaces] = useState<ClaudePlace[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const check = async () => {
    setChecking(true)
    try {
      setPlaces((await api.status()).places)
      setCheckError(null)
    } catch (err) {
      setCheckError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }
  useEffect(() => void check(), [])
  useHint('Aucune session Claude pour l’instant. On en lance une ? Coin.')

  const doing = new Set((board?.columns ?? []).filter((c) => c.group === 'doing').map((c) => c.name))
  const inProgress = (board?.tasks ?? []).filter((t) => doing.has(t.status)).slice(0, 5)

  return (
    <div className="page lc-empty">
      <Empty
        title="Aucune session Claude pour l’instant"
        action={
          <button type="button" className="btn-cta" onClick={() => start(null)}>
            Nouvelle session
          </button>
        }
      >
        Lance une session depuis une tâche en cours : Claude reçoit la tâche en contexte et travaille dans des worktrees à
        part.
      </Empty>
      <div className="lc-empty-grid">
        <section className="panel" aria-labelledby="lc-checks">
          <h2 id="lc-checks">Vérifications</h2>
          <Places places={places} checking={checking} error={checkError} />
          <div className="row">
            <button type="button" className="btn lunar-btn-sm" disabled={checking} onClick={() => void check()}>
              Vérifier à nouveau
            </button>
            <button type="button" className="btn lunar-btn-sm" onClick={() => navigate('/reglages/lunar-industries-claude')}>
              Réglages de Claude
            </button>
          </div>
        </section>
        <section className="panel" aria-labelledby="lc-tasks">
          <h2 id="lc-tasks">Tâches en cours</h2>
          {inProgress.length ? (
            inProgress.map((t) => (
              <div key={t.id} className="trow row lc-task">
                <span className="lc-check-text grow">
                  <strong className="ellipsis">{t.title}</strong>
                  <span className="legend">{t.ref ?? ''}</span>
                </span>
                <button type="button" className="btn lunar-btn-sm" aria-label={`Lancer une session sur ${t.title}`} onClick={() => start(t.id)}>
                  Lancer
                </button>
              </div>
            ))
          ) : (
            <span className="legend">Aucune tâche en cours sur le Kanban.</span>
          )}
        </section>
      </div>
    </div>
  )
}

// The Claude Code the sessions run (the one of the tools' environment), and whether it is logged in or the module has
// an API key. A check that failed says why, never « none found ».
export function Places({ places, checking, error }: { places: ClaudePlace[] | null; checking: boolean; error: string | null }) {
  if (error)
    return (
      <Alert>La vérification a échoué : {error}</Alert>
    )
  if (!places?.length) return <span className="legend">{checking || !places ? 'Recherche de Claude Code…' : 'Aucun Claude Code trouvé.'}</span>
  return (
    <>
      {places.map((p) => (
        <div key={p.where} className="lc-check">
          <span className={`tag lunar-tone-${p.error ? 'bad' : p.loggedIn || p.apiKey ? 'ok' : 'warn'}`}>
            {p.error ? 'introuvable' : p.loggedIn || p.apiKey ? 'prêt' : 'à connecter'}
          </span>
          <span className="lc-check-text">
            <strong>Claude Code {p.where === 'Ce poste' ? 'sur ce poste' : `dans ${p.where}`}</strong>
            <span className="legend">
              {p.error ??
                (p.apiKey
                  ? [`Version ${p.version ?? '?'}`, 'clé d’API des réglages'].join(' · ')
                  : p.loggedIn
                    ? [`Version ${p.version ?? '?'}`, p.email, p.subscription].filter(Boolean).join(' · ')
                    : 'Dans un terminal, lance « claude » puis « /login », une seule fois.')}
            </span>
          </span>
        </div>
      ))}
    </>
  )
}
