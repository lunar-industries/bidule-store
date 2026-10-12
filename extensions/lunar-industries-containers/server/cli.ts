// Taken from quack-board (apps/api/app/connectors/containers/container_cli.ts, Simon's latest), on the base of
// Bidule's official containers extension (its Flatpak handling).
import type { Environment } from '@bidule/api/extensions'
import { spawn, type ChildProcess } from 'node:child_process'
import type {
  Container,
  ContainerAction,
  ContainerDetail,
  ContainerFile,
  ContainerPort,
  ContainerState,
  UsageRow,
} from '../contract.ts'

// A failed command, with what it printed before failing (inspect prints the containers it found).
class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string
  ) {
    super(message)
  }
}

// The engines run where the outside tools run (ctx.env): inside WSL on Windows, in the toolbox or on the Flatpak's
// host, or here; from the home folder there. The environment builds or runs each command, so that it never runs
// somewhere else.

// What a failed command of the environment printed on one of its outputs (ctx.env.run gives them with the error).
const printed = (err: unknown, output: 'stdout' | 'stderr'): string => {
  const text = typeof err === 'object' && err !== null ? Reflect.get(err, output) : undefined
  return typeof text === 'string' ? text : ''
}

// What a command prints on stdout, run by the environment (ctx.env.run).
async function exec(env: Environment, cli: string, args: string[], timeout = 15_000): Promise<string> {
  try {
    return await env.run({ argv: [cli, ...args], timeout })
  } catch (err) {
    const message = printed(err, 'stderr').trim() || (err instanceof Error ? err.message : String(err))
    throw new CommandError(message, printed(err, 'stdout'))
  }
}

// `events` is listened to again after it ends: 10 s later the first time, then twice as long each time it ends again,
// up to 10 min; back to 10 s after a run that lasted more than a minute (the engine was there, then restarted).
const EVENTS_RETRY_MS = 10_000
const EVENTS_RETRY_MAX_MS = 10 * 60_000
const EVENTS_STEADY_MS = 60_000

export const nextRetry = (previous: number | null, lasted: number) =>
  previous === null || lasted > EVENTS_STEADY_MS ? EVENTS_RETRY_MS : Math.min(previous * 2, EVENTS_RETRY_MAX_MS)

// The lines of a followed container's logs are sent together when they come close: one message per line would be
// too many (a single wait after the first one, not a loop).
const LOG_BATCH_MS = 100

// What a long command of the engine says (it writes both outputs), and its end.
type Streamed = { data(text: string, from: 'stdout' | 'stderr'): void; end(): void }

// A long command of the engine (logs --follow, stats), started on what the environment builds: its outputs as they
// come, read whole (an output left unread would block it), and its end, which also comes when it cannot start.
function stream(env: Environment, start: typeof spawn, argv: string[], on: Streamed): () => void {
  const { file, args, cwd } = env.command({ argv })
  const child = start(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (text: string) => on.data(text, 'stdout'))
  child.stderr?.on('data', (text: string) => on.data(text, 'stderr'))
  child.on('error', () => {})
  child.on('close', () => on.end())
  return () => void child.kill()
}

// What `docker inspect` and `podman inspect` both give (Podman follows Docker's format), as far as the page needs.
type Bindings = Record<string, { HostIp?: string; HostPort?: string }[] | null> | null
type Inspected = {
  Id: string
  Name?: string
  IsInfra?: boolean
  Created?: string
  Config?: { Image?: string; Labels?: Record<string, string> | null }
  State?: { Status?: string; StartedAt?: string; FinishedAt?: string; ExitCode?: number }
  NetworkSettings?: { Ports?: Bindings; Networks?: Record<string, unknown> | null } | null
  Mounts?: { Name?: string | null; Source?: string; Destination?: string }[] | null
  HostConfig?: { PortBindings?: Bindings } | null
}

const STATES: ContainerState[] = ['running', 'paused', 'restarting', 'created', 'exited', 'dead']

// An engine's « never » is year 1 (0001-01-01T00:00:00Z).
function date(value: string | undefined): string | null {
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) || at.getUTCFullYear() < 1971 ? null : at.toISOString()
}

// `8008/tcp` → its bindings. Several per port (IPv4 and IPv6) show once; an address open to all is no address.
function ports(bindings: Bindings | undefined): ContainerPort[] {
  const out = new Map<string, ContainerPort>()
  for (const [key, list] of Object.entries(bindings ?? {})) {
    const [port, protocol = 'tcp'] = key.split('/')
    for (const b of list ?? []) {
      const hostPort = b.HostPort ? Number(b.HostPort) : null
      const hostIp = b.HostIp && !['0.0.0.0', '::', ''].includes(b.HostIp) ? b.HostIp : null
      const id = `${hostPort}/${port}/${protocol}`
      if (!out.has(id)) out.set(id, { hostIp, hostPort, port: Number(port), protocol })
    }
  }
  return [...out.values()].sort((a, b) => a.port - b.port || (a.hostPort ?? 0) - (b.hostPort ?? 0))
}

function toContainer(c: Inspected): Container {
  const labels = c.Config?.Labels ?? {}
  const status = c.State?.Status ?? ''
  const state: ContainerState = STATES.find((s) => s === status) ?? 'other'
  // A running container has its actual ports (random ones included); a stopped one, only what it asks for.
  const live = state === 'running' ? ports(c.NetworkSettings?.Ports) : []
  return {
    id: c.Id,
    name: (c.Name ?? c.Id.slice(0, 12)).replace(/^\//, ''),
    image: c.Config?.Image ?? '',
    state,
    startedAt: date(c.State?.StartedAt),
    finishedAt: date(c.State?.FinishedAt),
    exitCode: state === 'exited' || state === 'dead' ? (c.State?.ExitCode ?? null) : null,
    project: labels['com.docker.compose.project'] ?? labels['io.podman.compose.project'] ?? null,
    service: labels['com.docker.compose.service'] ?? labels['io.podman.compose.service'] ?? null,
    ports: live.length ? live : ports(c.HostConfig?.PortBindings),
  }
}

// The containers of an inspect output, a pod's infra container (Podman) left out.
// What the engine printed, checked: a reply that is not a list of containers (an error text, another format) is said, not
// read into a crash further on.
function inspectedOf(json: string): Inspected[] {
  let value: unknown
  try {
    value = JSON.parse(json || '[]')
  } catch {
    throw new Error('Réponse inattendue du moteur')
  }
  if (!Array.isArray(value)) throw new Error('Réponse inattendue du moteur')
  if (!value.every(isInspected)) throw new Error('Réponse inattendue du moteur')
  return value
}
// A container the page can read: an object with its id (the rest is optional, and read as such).
function isInspected(item: unknown): item is Inspected {
  return typeof item === 'object' && item !== null && typeof Reflect.get(item, 'Id') === 'string'
}
const inspected = (json: string) => inspectedOf(json).filter((c) => !c.IsInfra)

export function parseInspect(json: string): Container[] {
  return inspected(json).map(toContainer)
}

// The one container an inspect output holds, with what it is made of: its networks and what is mounted in it.
export function parseDetail(json: string): Omit<ContainerDetail, 'engine'> {
  const [c] = inspected(json)
  if (!c) throw new Error('Conteneur introuvable')
  return {
    ...toContainer(c),
    createdAt: date(c.Created),
    networks: Object.keys(c.NetworkSettings?.Networks ?? {}).sort(),
    mounts: (c.Mounts ?? []).map((m) => ({ name: m.Name || null, source: m.Source ?? '', destination: m.Destination ?? '' })),
  }
}

// `21.5MiB`, `1.2GB`, `512kB` → bytes. Docker counts MiB as 1024 × 1024 and MB as 1000 × 1000.
const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  kib: 1024,
  mb: 1e6,
  mib: 1024 ** 2,
  gb: 1e9,
  gib: 1024 ** 3,
  tb: 1e12,
  tib: 1024 ** 4,
}
function bytes(text: string): number {
  const found = /^([\d.]+)\s*([a-z]*)$/i.exec(text.trim())
  const unit = UNITS[(found?.[2] ?? 'b').toLowerCase()]
  return found?.[1] && unit ? Math.round(Number(found[1]) * unit) : 0
}

// What `stats --no-stream --format '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}'` prints, a line a running container:
// `3f2a9c1b7d4e|0.50%|21.5MiB / 7.6GiB`. The ids are the short ones, the engine's `ps` gives the long ones.
export function parseStats(text: string): Omit<UsageRow, 'engine'>[] {
  const out: Omit<UsageRow, 'engine'>[] = []
  for (const line of text.split('\n')) {
    const [id, cpu, usage] = line.trim().split('|')
    if (!id || cpu === undefined || usage === undefined) continue
    const [memory = '', limit = ''] = usage.split('/')
    out.push({ id, cpu: Number.parseFloat(cpu) || 0, memory: bytes(memory), limit: bytes(limit) })
  }
  return out
}

// What `ls -1Ap` prints: a name a line, a `/` after a folder's. Folders come first, each group by name.
export function parseListing(text: string): ContainerFile[] {
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => (l.endsWith('/') ? { name: l.slice(0, -1), directory: true } : { name: l, directory: false }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

const instantOf = (line: string) => Date.parse(line.slice(0, Math.max(line.indexOf(' '), 0)))

// A line of a container's logs begins with its time (`--timestamps`), which orders what came out of stdout and
// stderr.
export function mergeLogs(...outputs: string[]): string[] {
  return outputs
    .flatMap((o) => o.split('\n'))
    .filter((l) => l.length > 0)
    .map((line, i) => ({ line, i }))
    .sort((a, b) => {
      // As instants first (an engine may write an offset, or a fraction of another length), then as written (the
      // nanoseconds), then as they came.
      const x = instantOf(a.line)
      const y = instantOf(b.line)
      if (x !== y && !Number.isNaN(x) && !Number.isNaN(y)) return x - y
      const s = a.line.slice(0, 35)
      const t = b.line.slice(0, 35)
      return s < t ? -1 : s > t ? 1 : a.i - b.i
    })
    .map((l) => l.line)
}

/**
 * Docker and Podman through their command line, which both accept the same commands (`ps`, `inspect`, `start`,
 * `stats`, `logs`, `events`): one class, given the command. Only the user's own containers show (no sudo); a missing
 * command leaves the engine out.
 */
export class ContainerCli {
  #version: { at: number; value: Promise<string | null> } | null = null
  #host: Promise<{ cpus: number; memory: number }> | null = null

  constructor(
    readonly cli: 'docker' | 'podman',
    readonly name: string,
    protected env: Environment,
    // Starts a long command the environment built (events, and what the page follows); another one in the tests.
    protected start: typeof spawn = spawn
  ) {}

  get id(): string {
    return this.cli
  }

  // The engine's version, or null without it. `docker` may be Podman's stand-in (podman-docker): that one is
  // already shown as Podman, so it counts as no Docker. Checked once a minute at most.
  version(): Promise<string | null> {
    if (this.#version && Date.now() - this.#version.at < 60_000) return this.#version.value
    const value = exec(this.env, this.cli, ['--version'], 5_000).then(
      (out) => (this.cli === 'docker' && /podman/i.test(out) ? null : out.trim()),
      () => null
    )
    this.#version = { at: Date.now(), value }
    return value
  }

  async isConfigured(): Promise<boolean> {
    return (await this.version()) !== null
  }

  async list(): Promise<Container[]> {
    const out = await exec(this.env, this.cli, ['ps', '-a', '-q', '--no-trunc'])
    const ids = out.split(/\s+/).filter(Boolean)
    if (!ids.length) return []
    // A container removed between the two commands makes inspect fail, but the others are still in its output.
    const json = await exec(this.env, this.cli, ['inspect', '--type', 'container', ...ids]).catch((err: unknown) => {
      if (err instanceof CommandError && err.stdout.trim()) return err.stdout
      throw err
    })
    return parseInspect(json)
  }

  async detail(id: string): Promise<Omit<ContainerDetail, 'engine'>> {
    return parseDetail(await exec(this.env, this.cli, ['inspect', '--type', 'container', id]))
  }

  async act(id: string, action: ContainerAction): Promise<void> {
    // A running container is stopped before it goes (`rm -f`); its volumes stay.
    await exec(this.env, this.cli, action === 'remove' ? ['rm', '-f', id] : [action, id], 60_000)
  }

  // The machine's cores and memory, which do not change while the engine runs: asked once.
  host(): Promise<{ cpus: number; memory: number }> {
    const format = this.cli === 'docker' ? '{{.NCPU}}|{{.MemTotal}}' : '{{.Host.CPUs}}|{{.Host.MemTotal}}'
    this.#host ??= exec(this.env, this.cli, ['info', '--format', format], 15_000).then(
      (out) => {
        const [cpus, memory] = out.trim().split('|')
        return { cpus: Number(cpus) || 0, memory: Number(memory) || 0 }
      },
      () => ({ cpus: 0, memory: 0 })
    )
    return this.#host
  }

  async usage(): Promise<{ cpus: number; memory: number; containers: Omit<UsageRow, 'engine'>[] }> {
    const [host, out] = await Promise.all([
      this.host(),
      exec(this.env, this.cli, ['stats', '--no-stream', '--format', '{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}'], 30_000),
    ])
    return { ...host, containers: parseStats(out) }
  }

  async files(id: string, path: string): Promise<ContainerFile[]> {
    // `ls` is given the path after `--`, so a folder named like an option is still a folder.
    return parseListing(await exec(this.env, this.cli, ['exec', id, 'ls', '-1Ap', '--', path]))
  }

  /**
   * A container's logs followed by the engine (`logs --follow`): its last `tail` lines, then each new one, given in
   * batches (each in the order of its lines' times, as both outputs came); `end` when the command ends (the container
   * stopped or removed, the engine gone, or stopped here). Gives how to stop it.
   */
  followLogs(id: string, tail: number, on: { lines(lines: string[]): void; end(): void }): () => void {
    const rest = { stdout: '', stderr: '' }
    let pending: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] }
    let batch: NodeJS.Timeout | undefined
    const flush = () => {
      batch = undefined
      const lines = mergeLogs(pending.stdout.join('\n'), pending.stderr.join('\n'))
      pending = { stdout: [], stderr: [] }
      if (lines.length) on.lines(lines)
    }
    const stop = stream(this.env, this.start, [this.cli, 'logs', '--follow', '--timestamps', '--tail', String(tail), id], {
      data: (text, from) => {
        const parts = (rest[from] + text).split('\n')
        rest[from] = parts.pop() ?? ''
        pending[from].push(...parts.filter(Boolean))
        batch ??= setTimeout(flush, LOG_BATCH_MS)
      },
      end: () => {
        clearTimeout(batch)
        pending.stdout.push(rest.stdout)
        pending.stderr.push(rest.stderr)
        flush()
        on.end()
      },
    })
    return stop
  }

  watch(onChange: () => void): () => void {
    let child: ChildProcess | null = null
    let stopped = false
    let debounce: NodeJS.Timeout | undefined
    let retry: NodeJS.Timeout | undefined
    // The last wait before listening again (see nextRetry).
    let wait: number | null = null
    const start = () => {
      const startedAt = Date.now()
      const { file, args, cwd } = this.env.command({
        argv: [this.cli, 'events', '--format', '{{json .}}', '--filter', 'type=container'],
      })
      child = this.start(file, args, { stdio: ['ignore', 'pipe', 'ignore'], cwd, windowsHide: true })
      // One change often comes as several events (create, start, attach…): they count once.
      child.stdout?.on('data', () => {
        clearTimeout(debounce)
        debounce = setTimeout(onChange, 300)
      })
      child.on('error', () => {})
      // The engine restarted, or the command died (or could not start): listen again later, ever later while it keeps
      // ending at once.
      child.on('close', () => {
        if (stopped) return
        wait = nextRetry(wait, Date.now() - startedAt)
        retry = setTimeout(start, wait)
      })
    }
    start()
    return () => {
      stopped = true
      clearTimeout(debounce)
      clearTimeout(retry)
      child?.kill()
    }
  }
}
