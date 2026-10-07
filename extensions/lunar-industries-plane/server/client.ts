// Plane's REST API (https://developers.plane.so/api-reference/introduction), as far as this extension reads it. Its
// answers are checked as they arrive: a field missing or of another type fails here, with Plane named, not later in
// the sync. Only what the extension reads is listed.

// A refusal carries its status: a 401 is a key expired or revoked, a 403 a key without the right scope.
export class PlaneError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/**
 * The address of a Plane instance as the API wants it: what the user typed, without a trailing slash, nor the
 * `/api/v1` they may have copied from the documentation. Null when it is no address at all.
 */
export function planeBase(typed: string): string | null {
  const text = typed.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (!url.hostname) return null
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api(\/v\d+)?$/, '')
  return `${url.origin}${path}`
}

export interface PlaneUser {
  id: string
  displayName: string | null
  email: string | null
}

// `identifier` is the short code of the project's work items (« ACC » in ACC-123).
export interface PlaneProject {
  id: string
  name: string
  identifier: string
}

// A state of a project's workflow. Its `group` is one of Plane's five: backlog, unstarted, started, completed,
// cancelled; `sequence` orders the states of a project.
export interface PlaneState {
  id: string
  name: string
  group: string
  color: string | null
  sequence: number | null
}

// Plane's name for a task. Its state and assignees are ids.
export interface PlaneWorkItem {
  id: string
  project: string
  sequenceId: number
  name: string
  state: string
  assignees: string[]
  descriptionHtml: string | null
  targetDate: string | null
  completedAt: string | null
  updatedAt: string
  updatedBy: string | null
}

export interface PlaneComment {
  id: string
  html: string | null
  stripped: string | null
  createdAt: string
}

export interface PlaneMember {
  id: string
  displayName: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
}

/** What the sync reads from Plane: the client, or a stand-in in the tests. */
export interface PlaneReader {
  me(): Promise<PlaneUser>
  projects(slug: string): Promise<PlaneProject[]>
  states(slug: string, project: string): Promise<PlaneState[]>
  workItems(slug: string, project: string): Promise<PlaneWorkItem[]>
}

/** Everything the extension asks of Plane. */
export interface PlaneApi extends PlaneReader {
  workItem(slug: string, project: string, workItem: string): Promise<PlaneWorkItem>
  comments(slug: string, project: string, workItem: string): Promise<PlaneComment[]>
  addComment(slug: string, project: string, workItem: string, html: string): Promise<void>
  members(slug: string): Promise<PlaneMember[]>
  setState(slug: string, project: string, workItem: string, state: string): Promise<void>
}

const unexpected = (what: string) => new PlaneError(`Plane : réponse inattendue (${what})`, 502)

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected(what)
  return Object.fromEntries(Object.entries(value))
}

function text(from: Record<string, unknown>, key: string, what: string): string {
  const value = from[key]
  if (typeof value !== 'string') throw unexpected(`${what}.${key}`)
  return value
}

function maybeText(from: Record<string, unknown>, key: string): string | null {
  const value = from[key]
  return typeof value === 'string' ? value : null
}

function number(from: Record<string, unknown>, key: string, what: string): number {
  const value = from[key]
  if (typeof value !== 'number') throw unexpected(`${what}.${key}`)
  return value
}

const readUser = (raw: unknown): PlaneUser => {
  const o = object(raw, 'utilisateur')
  return { id: text(o, 'id', 'utilisateur'), displayName: maybeText(o, 'display_name'), email: maybeText(o, 'email') }
}

const readProject = (raw: unknown): PlaneProject => {
  const o = object(raw, 'projet')
  return { id: text(o, 'id', 'projet'), name: text(o, 'name', 'projet'), identifier: text(o, 'identifier', 'projet') }
}

const readState = (raw: unknown): PlaneState => {
  const o = object(raw, 'état')
  const sequence = o.sequence
  return {
    id: text(o, 'id', 'état'),
    name: text(o, 'name', 'état'),
    group: text(o, 'group', 'état'),
    color: maybeText(o, 'color'),
    sequence: typeof sequence === 'number' ? sequence : null,
  }
}

const readWorkItem = (raw: unknown): PlaneWorkItem => {
  const o = object(raw, 'work item')
  const assignees = o.assignees
  return {
    id: text(o, 'id', 'work item'),
    project: text(o, 'project', 'work item'),
    sequenceId: number(o, 'sequence_id', 'work item'),
    name: text(o, 'name', 'work item'),
    state: text(o, 'state', 'work item'),
    assignees: Array.isArray(assignees) ? assignees.filter((a) => typeof a === 'string') : [],
    descriptionHtml: maybeText(o, 'description_html'),
    targetDate: maybeText(o, 'target_date'),
    completedAt: maybeText(o, 'completed_at'),
    updatedAt: text(o, 'updated_at', 'work item'),
    updatedBy: maybeText(o, 'updated_by'),
  }
}

const readComment = (raw: unknown): PlaneComment => {
  const o = object(raw, 'commentaire')
  return {
    id: text(o, 'id', 'commentaire'),
    html: maybeText(o, 'comment_html'),
    stripped: maybeText(o, 'comment_stripped'),
    createdAt: text(o, 'created_at', 'commentaire'),
  }
}

const readMember = (raw: unknown): PlaneMember => {
  const o = object(raw, 'membre')
  return {
    id: text(o, 'id', 'membre'),
    displayName: maybeText(o, 'display_name'),
    firstName: maybeText(o, 'first_name'),
    lastName: maybeText(o, 'last_name'),
    email: maybeText(o, 'email'),
  }
}

// A page of a paginated list: the items, and the cursor of the next page when there is one.
function readPage(raw: unknown): { results: unknown[]; cursor: string | null } {
  const o = object(raw, 'liste')
  if (!Array.isArray(o.results)) throw unexpected('liste.results')
  return { results: o.results, cursor: o.next_page_results === true ? maybeText(o, 'next_cursor') : null }
}

// How long a request may take, and how many times one is tried again after Plane says to wait.
const TIMEOUT_MS = 20_000
const ATTEMPTS = 3
// Plane allows 60 requests a minute: when it says none are left, wait for the count to restart, but never longer
// than this (the user is waiting for a sync).
const MAX_WAIT_MS = 65_000

// The pause Plane asks for, in milliseconds: `Retry-After` in seconds, else the time to the reset the rate limit
// headers announce (a date in seconds since 1970, or a number of seconds from now).
export function waitFor(headers: Headers, now = Date.now()): number | null {
  const retry = Number(headers.get('retry-after'))
  if (Number.isFinite(retry) && retry > 0) return Math.min(retry * 1000, MAX_WAIT_MS)
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (!Number.isFinite(reset) || reset <= 0) return null
  const at = reset > 1e9 ? reset * 1000 : now + reset * 1000
  return Math.min(Math.max(at - now, 0), MAX_WAIT_MS)
}

// Why a request never got an answer, in words the settings page can show.
function unreachable(base: string, err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null
  const code = cause && 'code' in cause ? String(cause.code) : ''
  if (/CERT|SELF_SIGNED|ISSUER/.test(code)) return `Plane (${base}) : le certificat de l'instance n'est pas reconnu`
  if (code === 'ENOTFOUND') return `Plane (${base}) : adresse introuvable`
  if (code === 'ECONNREFUSED') return `Plane (${base}) : connexion refusée`
  if (err instanceof Error && err.name === 'TimeoutError') return `Plane (${base}) : pas de réponse`
  return `Plane (${base}) : instance injoignable`
}

export class PlaneClient implements PlaneApi {
  // The requests left in the minute, as Plane last said; asked before each request.
  #remaining = Infinity
  #resetsAt = 0

  constructor(
    readonly base: string,
    private readonly key: string
  ) {}

  // Plane's answer as it came: the readers check it.
  async call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      await this.#room()
      let res: Response
      try {
        res = await fetch(`${this.base}/api/v1${path}`, {
          method,
          headers: { 'X-API-Key': this.key, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (err) {
        throw new PlaneError(unreachable(this.base, err), 0)
      }
      this.#note(res.headers)
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, waitFor(res.headers) ?? 5000))
        continue
      }
      if (!(res.headers.get('content-type') ?? '').includes('json')) {
        throw new PlaneError(
          `Plane (${this.base}) : cette adresse ne répond pas comme une instance Plane (réponse ${res.status} qui n'est pas du JSON)`,
          res.status
        )
      }
      const json: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = typeof json === 'object' && json !== null && 'error' in json ? json.error : null
        throw new PlaneError(
          `Plane ${res.status} : ${typeof reason === 'string' ? reason : res.statusText}`,
          res.status
        )
      }
      return json
    }
    throw new PlaneError('Plane : trop de requêtes, réessaie dans un instant', 429)
  }

  // Waits for the minute to restart when none of its 60 requests is left.
  async #room(): Promise<void> {
    if (this.#remaining > 0) return
    const wait = Math.min(this.#resetsAt - Date.now(), MAX_WAIT_MS)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.#remaining = Infinity
  }

  #note(headers: Headers): void {
    const left = headers.get('x-ratelimit-remaining')
    if (left === null || !Number.isFinite(Number(left))) return
    this.#remaining = Number(left)
    this.#resetsAt = Date.now() + (waitFor(headers) ?? 0)
  }

  // Every item of a list, page after page (100 at a time, the most Plane gives).
  async #all<T>(read: (raw: unknown) => T, path: string): Promise<T[]> {
    const out: T[] = []
    let cursor: string | null = null
    do {
      const query: URLSearchParams = new URLSearchParams({ per_page: '100' })
      if (cursor) query.set('cursor', cursor)
      const page = readPage(await this.call('GET', `${path}?${query.toString()}`))
      out.push(...page.results.map(read))
      cursor = page.cursor
    } while (cursor)
    return out
  }

  async me(): Promise<PlaneUser> {
    return readUser(await this.call('GET', '/users/me/'))
  }

  // The projects of the workspace the key sees (its slug is the one in the address of the web interface); a slug that
  // does not exist, or a key without access to it, fails here.
  projects(slug: string): Promise<PlaneProject[]> {
    return this.#all(readProject, `/workspaces/${slug}/projects/`)
  }

  states(slug: string, project: string): Promise<PlaneState[]> {
    return this.#all(readState, `/workspaces/${slug}/projects/${project}/states/`)
  }

  // Every work item of a project, assigned to anyone: the caller keeps the user's.
  workItems(slug: string, project: string): Promise<PlaneWorkItem[]> {
    return this.#all(readWorkItem, `/workspaces/${slug}/projects/${project}/work-items/`)
  }

  async workItem(slug: string, project: string, workItem: string): Promise<PlaneWorkItem> {
    return readWorkItem(await this.call('GET', `/workspaces/${slug}/projects/${project}/work-items/${workItem}/`))
  }

  comments(slug: string, project: string, workItem: string): Promise<PlaneComment[]> {
    return this.#all(readComment, `/workspaces/${slug}/projects/${project}/work-items/${workItem}/comments/`)
  }

  async addComment(slug: string, project: string, workItem: string, html: string): Promise<void> {
    await this.call('POST', `/workspaces/${slug}/projects/${project}/work-items/${workItem}/comments/`, {
      comment_html: html,
    })
  }

  // The workspace's members: a plain list, or a page of them, depending on the version of Plane.
  async members(slug: string): Promise<PlaneMember[]> {
    const answer = await this.call('GET', `/workspaces/${slug}/members/`)
    const items = Array.isArray(answer) ? answer : readPage(answer).results
    return items.map(readMember)
  }

  // Moves a work item to a state (the id of one of its project's states).
  async setState(slug: string, project: string, workItem: string, state: string): Promise<void> {
    await this.call('PATCH', `/workspaces/${slug}/projects/${project}/work-items/${workItem}/`, { state })
  }
}
