import { relTime } from '@bidule/sdk'
import type { ContainerPort, ContainerRow, UsageRow } from '../contract.ts'

// What the list and a container's view say of the containers, computed without drawing anything (tested in
// format.test.ts).

export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// A container in a list of several engines' (Docker and Podman may both run one with the same id).
export const keyOf = (c: { engine: string; id: string }) => `${c.engine}:${c.id}`

/**
 * What a tick is kept under: the project and the service for a Compose service, the name for the others. Both
 * outlive the container: `docker compose up` recreates a service's container with a new id, under the same project
 * and service. A service scaled to several containers is ticked as one.
 */
export const tickKeyOf = (c: Pick<ContainerRow, 'engine' | 'name' | 'project' | 'service'>) =>
  c.project && c.service ? `${c.engine}:${c.project}/${c.service}` : `${c.engine}:${c.name}`

// Where an action applies: a container that runs (or is about to, or is paused) can be restarted or stopped.
export const isUp = (c: Pick<ContainerRow, 'state'>) =>
  c.state === 'running' || c.state === 'restarting' || c.state === 'paused'

// The codes of a container stopped on purpose: by itself (0), by Ctrl-C (130), or by `stop` (143 for its SIGTERM,
// 137 for the SIGKILL after the grace period). Any other code is a failure.
const STOPPED_CODES = new Set([0, 130, 137, 143])

// A container that died or stopped on an error: the list keeps it in view and the tab counts it.
export const isFailed = (c: Pick<ContainerRow, 'state' | 'exitCode'>) =>
  c.state === 'dead' || (c.state === 'exited' && c.exitCode !== null && !STOPPED_CODES.has(c.exitCode))

// What « Actifs » shows: what runs, and what needs a look (restarting, paused, failed).
export const isActive = (c: Pick<ContainerRow, 'state' | 'exitCode'>) => isUp(c) || isFailed(c)

export type Tone = 'ok' | 'warn' | 'bad' | 'off'

// A container's state in a few words, and its colour.
export function stateOf(c: Pick<ContainerRow, 'state' | 'exitCode'>): { label: string; tone: Tone } {
  if (isFailed(c)) return { label: c.state === 'dead' ? 'mort' : `en échec (code ${c.exitCode})`, tone: 'bad' }
  switch (c.state) {
    case 'running':
      return { label: 'en marche', tone: 'ok' }
    case 'restarting':
      return { label: 'redémarre', tone: 'warn' }
    case 'paused':
      return { label: 'en pause', tone: 'warn' }
    case 'created':
      return { label: 'créé, jamais démarré', tone: 'off' }
    default:
      return { label: 'arrêté', tone: 'off' }
  }
}

// Since when it is in that state: « depuis 2 h », « il y a 4 min ».
export function sinceOf(c: Pick<ContainerRow, 'state' | 'startedAt' | 'finishedAt'>, now = Date.now()): string {
  if (isUp(c)) return c.startedAt ? relTime(c.startedAt, now).replace(/^il y a/, 'depuis') : ''
  return c.finishedAt ? relTime(c.finishedAt, now) : ''
}

// « il y a 3 j », or a dash when the engine never said.
export const when = (at: string | null) => (at ? relTime(at) || '—' : '—')

// How a container is called in a project, by its service (« db »), which says what it is for; elsewhere, by its name.
export const titleOf = (c: Pick<ContainerRow, 'name' | 'project' | 'service'>) => (c.project && c.service ? c.service : c.name)

/**
 * A project's health, over all its containers whatever the filter shows: « 4 en marche », or what is missing,
 * « 3 sur 4 · db en échec (code 1) », « 1 sur 3 · 2 arrêtés ».
 */
export function healthOf(containers: ContainerRow[]): { label: string; tone: Tone } {
  const running = containers.filter((c) => c.state === 'running')
  const down = containers.filter((c) => c.state !== 'running')
  const tone: Tone = containers.some(isFailed) ? 'bad' : !running.length ? 'off' : down.length ? 'warn' : 'ok'
  if (!down.length) return { label: `${running.length} en marche`, tone }
  if (!running.length) return { label: containers.length > 1 ? `${containers.length} arrêtés` : stateOf(containers[0]).label, tone }
  const failed = down.filter(isFailed).length
  const what =
    down.length <= 2
      ? down.map((c) => `${titleOf(c)} ${stateOf(c).label}`).join(', ')
      : `${down.length} à l’arrêt${failed ? `, dont ${failed} en échec` : ''}`
  return { label: `${running.length} sur ${containers.length} · ${what}`, tone }
}

// The containers outside any project are no whole: only how many run, in the colour of a failure if one failed.
export function looseHealthOf(containers: ContainerRow[]): { label: string; tone: Tone } {
  const running = containers.filter((c) => c.state === 'running').length
  return { label: `${running} en marche sur ${containers.length}`, tone: containers.some(isFailed) ? 'bad' : running ? 'ok' : 'off' }
}

// Where a published port answers: a link for a running container's TCP port.
export function portUrl(c: Pick<ContainerRow, 'state'>, p: ContainerPort): string | null {
  if (c.state !== 'running' || p.protocol !== 'tcp' || !p.hostPort) return null
  const host = !p.hostIp || p.hostIp === '127.0.0.1' || p.hostIp === '0.0.0.0' ? 'localhost' : p.hostIp.includes(':') ? `[${p.hostIp}]` : p.hostIp
  return `http://${host}:${p.hostPort}`
}

// « 3000 », « 8080 → 80 », « 53/udp ».
export function portLabel(p: ContainerPort): string {
  const inside = p.protocol === 'tcp' ? `${p.port}` : `${p.port}/${p.protocol}`
  return !p.hostPort || p.hostPort === p.port ? inside : `${p.hostPort} → ${inside}`
}

// The same port published on IPv4 and IPv6 is shown once.
export function portsOf(ports: ContainerPort[]): ContainerPort[] {
  const seen = new Set<string>()
  return ports.filter((p) => {
    const key = `${p.hostPort}/${p.port}/${p.protocol}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// What a container uses: the engine gives the short id, the list has the long one.
export const usageRowOf = (rows: readonly UsageRow[], c: Pick<ContainerRow, 'engine' | 'id'>) =>
  rows.find((r) => r.engine === c.engine && c.id.startsWith(r.id))

const oneDecimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} o`
  if (bytes < 1024 ** 2) return `${oneDecimal.format(bytes / 1024)} Ko`
  if (bytes < 1024 ** 3) return `${oneDecimal.format(bytes / 1024 ** 2)} Mo`
  return `${twoDecimals.format(bytes / 1024 ** 3)} Go`
}

// « 0,4 % », « 12 % ».
export const fmtPercent = (percent: number) => `${oneDecimal.format(percent)} %`

/**
 * The top of a chart, fixed rather than following the highest measure, so that a flat line reads as flat: one core
 * (100 %) for the processor, or as many whole cores as the measures went over; the limit for the memory.
 */
export function chartTop(kind: 'cpu' | 'memory', samples: number[], limit: number): number {
  if (kind === 'memory') return Math.max(limit, ...samples, 1)
  return Math.max(1, Math.ceil(Math.max(0, ...samples) / 100)) * 100
}

// A line through the samples, from the left, under `top`: the points of an SVG of 100 by 100.
export function chartPoints(samples: number[], top: number): { line: string; area: string } {
  if (samples.length < 2) return { line: '', area: '' }
  const points = samples.map((v, i) => `${((i / (samples.length - 1)) * 100).toFixed(2)},${(100 - (Math.min(v, top) / top) * 100).toFixed(2)}`)
  return { line: points.join(' '), area: `0,100 ${points.join(' ')} 100,100` }
}

export type LogLevel = 'error' | 'warn'
export type LogLine = { stamp: string; time: string; text: string; level: LogLevel | null }

const ERROR = /\b(error|fatal|panic|critical|crit|emerg|alert)\b/i
const WARN = /\b(warn|warning)\b/i

// A line of the logs begins with its time (`--timestamps`): « 2026-10-01T07:12:03.114000000Z message ». Its level is
// a word of it, in capitals or not (`ERROR`, `level=error`, `"level":"warn"`).
export function parseLine(line: string): LogLine {
  const space = line.indexOf(' ')
  const stamp = space > 0 ? line.slice(0, space) : ''
  const at = stamp ? new Date(stamp) : null
  const valid = at !== null && !Number.isNaN(at.getTime())
  const text = valid ? line.slice(space + 1) : line
  const two = (n: number) => String(n).padStart(2, '0')
  return {
    stamp: valid ? stamp : '',
    time: valid ? `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, '0')}` : '',
    text,
    level: ERROR.test(text) ? 'error' : WARN.test(text) ? 'warn' : null,
  }
}

// The logs as text, to copy or save: each line with the time the engine wrote.
export const logsText = (lines: LogLine[]) => lines.map((l) => (l.stamp ? `${l.stamp} ${l.text}` : l.text)).join('\n') + '\n'

// A line cut around what the search found, for the found parts to be marked; the search folded (fold).
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  if (!q) return [{ text, hit: false }]
  // Folding keeps the length of most texts; when it does not (a ligature), the line is shown unmarked.
  const folded = fold(text)
  if (folded.length !== text.length) return [{ text, hit: false }]
  const parts: { text: string; hit: boolean }[] = []
  let from = 0
  for (let at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false })
    parts.push({ text: text.slice(at, at + q.length), hit: true })
    from = at + q.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false })
  return parts
}

// What the page has shown of the logs: the time of the last line (as the engine wrote it, to ask for what follows, and as
// an instant, to compare) and the texts shown at that very time.
export type LogCursor = { stamp: string; at: number; seen: ReadonlySet<string> }
export const NO_LOGS: LogCursor = { stamp: '', at: Number.NEGATIVE_INFINITY, seen: new Set() }

/**
 * The lines of a reading not shown yet, and where the page is now: those later than the last shown, those at its very
 * time that were not shown (an engine gives the lines from that time on, the last one again; several lines may share a
 * time), and those without a time. Times are compared as instants, so an offset (`+02:00`) or a fraction of another length
 * does not mislead.
 */
export function followLogs(lines: LogLine[], cursor: LogCursor): { fresh: LogLine[]; cursor: LogCursor } {
  const at = (l: LogLine) => Date.parse(l.stamp)
  const fresh = lines.filter((l) => !l.stamp || at(l) > cursor.at || (at(l) === cursor.at && !cursor.seen.has(l.text)))
  const stamped = fresh.filter((l) => l.stamp)
  if (!stamped.length) return { fresh, cursor }
  const latest = Math.max(...stamped.map(at))
  const last = stamped.filter((l) => at(l) === latest)
  const seen = new Set([...(latest === cursor.at ? cursor.seen : []), ...last.map((l) => l.text)])
  return { fresh, cursor: { stamp: last[last.length - 1].stamp, at: latest, seen } }
}

// The environment's variables whose value is hidden until asked: those named like a secret.
export const isSecretName = (name: string) => /pass|secret|token|key|credential|private|auth/i.test(name)
