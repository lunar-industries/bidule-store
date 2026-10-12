import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import type {
  ContainerAction,
  ContainerDetail,
  ContainerFile,
  ContainerList,
  LogsEvent,
  Usage,
  UsageEvent,
  UsageRow,
} from '../contract.ts'
import type { ContainerCli } from './cli.ts'
import { Follows } from './follow.ts'

// What the terminal runs (see TerminalLaunch in the core).
export type Launch = { argv: string[]; cwd: string }

// What the service tells (the module's events).
export interface Tell {
  // A container started, stopped, appeared or went.
  changed(): void
  // Lines of a followed container's logs, or its end.
  logs(event: LogsEvent): void
  // A measure of the resources followed, or its end.
  usage(event: UsageEvent): void
}

export class ContainerError extends Exception {
  async handle(error: this, ctx: HttpContext) {
    ctx.response.status(error.status).send({ error: error.message })
  }
}

// What a container's id or name looks like (never an option: no leading `-`).
const CONTAINER = /^[\w][\w.-]{0,127}$/
const LOG_TAIL = 500

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Taken from quack-board (ContainerService, Simon's latest): the containers of every engine present (Docker,
 * Podman, or both). While a page listens to `lunar-industries-containers.changed`, each engine's events are watched:
 * every start, stop or removal is told. A container's files are asked of the engines only when the page
 * asks; what the containers use and a container's logs are followed by the engines while the page shows them (see
 * Follows), told as they come. A shell inside or the logs in the terminal are built here from a known engine and a
 * known container: the window never sends a command.
 */
export class ContainerService {
  #watching = new Map<string, () => void>()
  #follows = new Follows()
  // Whether a page listens to `changed` (follow): only then are the engines' events watched.
  #listened = false
  // The lines each logs' follow has read so far (the last LOG_TAIL), by follow: a page that joins it gets them.
  #lines = new Map<string, string[]>()
  // The last measure of the resources' follow, by follow.
  #usages = new Map<string, Usage>()

  constructor(
    protected engines: ContainerCli[],
    protected tell: Tell,
    // The extension's folder in the app's data: the ticked containers are kept there.
    protected dataDir: () => Promise<string>
  ) {}

  async #present(): Promise<ContainerCli[]> {
    const present = await Promise.all(this.engines.map((e) => e.isConfigured().catch(() => false)))
    return this.engines.filter((_, i) => present[i])
  }

  async #engine(engineId: string): Promise<ContainerCli> {
    const engine = (await this.#present()).find((e) => e.id === engineId)
    if (!engine) throw new ContainerError('Moteur de conteneurs introuvable', { status: 404 })
    return engine
  }

  // A known engine, and an id that cannot pass for an option.
  async #target(engineId: string, id: string): Promise<ContainerCli> {
    if (!CONTAINER.test(id)) throw new ContainerError('Conteneur inconnu', { status: 404 })
    return this.#engine(engineId)
  }

  async list(): Promise<ContainerList> {
    const engines = await this.#present()
    const out: ContainerList = { engines: engines.map((e) => ({ id: e.id, name: e.name })), containers: [], errors: [] }
    await Promise.all(
      engines.map(async (e) => {
        // An engine installed while the page is open is watched from the next list.
        if (this.#listened) this.#watch(e)
        try {
          for (const c of await e.list()) out.containers.push({ ...c, engine: e.id })
        } catch (err) {
          out.errors.push({ engine: e.name, message: messageOf(err) })
        }
      })
    )
    out.containers.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  async detail(engineId: string, id: string): Promise<ContainerDetail> {
    const engine = await this.#target(engineId, id)
    try {
      return { ...(await engine.detail(id)), engine: engine.id }
    } catch (err) {
      throw new ContainerError(messageOf(err), { status: 404 })
    }
  }

  async act(engineId: string, id: string, action: ContainerAction): Promise<void> {
    const engine = await this.#target(engineId, id)
    try {
      await engine.act(id, action)
    } catch (err) {
      throw new ContainerError(messageOf(err), { status: 422 })
    }
    // The events would say it too, but the page should not wait for them.
    this.tell.changed()
  }

  // A shell in the container (bash where there is one, sh otherwise), or its last lines then what follows.
  async launch(engineId: string, id: string, kind: 'shell' | 'logs', home: string): Promise<Launch> {
    const engine = await this.#target(engineId, id)
    const argv =
      kind === 'logs'
        ? [engine.cli, 'logs', '--follow', '--tail', '500', id]
        : [engine.cli, 'exec', '-it', id, 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh']
    return { argv, cwd: home }
  }

  /**
   * What the running containers use of the machine, followed by every engine present (`stats`), told at each of their
   * measures (`lunar-industries-containers.usage`, by the follow's id): the machine is the biggest of the engines'
   * (Docker and Podman may share it), the containers are each engine's own. One follow for every view; gives its id
   * and the last measure (null before the first). Without any engine there is nothing to follow: no id, no place taken.
   */
  async followUsage(): Promise<{ follow: string | null; usage: Usage | null }> {
    const engines = await this.#present()
    if (!engines.length) return { follow: null, usage: null }
    const hosts = await Promise.all(engines.map((e) => e.host()))
    const machine = { cpus: Math.max(0, ...hosts.map((h) => h.cpus)), memory: Math.max(0, ...hosts.map((h) => h.memory)) }
    const follow = this.#follows.join('usage', (followId) => {
      const rows = new Map<string, UsageRow[]>()
      let running = engines.length
      const stops = engines.map((e) =>
        e.followUsage({
          rows: (measured) => {
            rows.set(e.id, measured.map((r) => ({ ...r, engine: e.id })))
            const usage: Usage = { ...machine, containers: [...rows.values()].flat() }
            this.#usages.set(followId, usage)
            this.tell.usage({ follow: followId, usage, ended: false })
          },
          // An engine gone: its containers no longer count; the follow ends with the last engine.
          end: () => {
            rows.delete(e.id)
            running -= 1
            if (running > 0) return
            this.#follows.ended(followId)
            this.#usages.delete(followId)
            this.tell.usage({ follow: followId, usage: null, ended: true })
          },
        })
      )
      return () => {
        for (const stop of stops) stop()
      }
    })
    return { follow, usage: this.#usages.get(follow) ?? null }
  }

  /**
   * A container's logs followed by its engine, its lines told as they come (`lunar-industries-containers.logs`, by the
   * follow's id); joined when another page follows them already. Gives the follow's id and the lines it has read so
   * far: subscribed first, then asked, the page loses none.
   */
  async followLogs(engineId: string, id: string): Promise<{ follow: string; lines: string[] }> {
    const engine = await this.#target(engineId, id)
    const follow = this.#follows.join(`logs ${engine.id} ${id}`, (followId) => {
      this.#lines.set(followId, [])
      return engine.followLogs(id, LOG_TAIL, {
        lines: (lines) => {
          this.#lines.set(followId, [...(this.#lines.get(followId) ?? []), ...lines].slice(-LOG_TAIL))
          this.tell.logs({ follow: followId, lines, ended: false })
        },
        end: () => {
          this.#follows.ended(followId)
          this.#lines.delete(followId)
          this.tell.logs({ follow: followId, lines: [], ended: true })
        },
      })
    })
    return { follow, lines: this.#lines.get(follow) ?? [] }
  }

  // The page no longer follows it: the last one to leave stops the engine's command.
  unfollow(follow: string): void {
    this.#follows.leave(follow)
  }

  async files(engineId: string, id: string, path: string): Promise<ContainerFile[]> {
    const engine = await this.#target(engineId, id)
    try {
      return await engine.files(id, path)
    } catch (err) {
      throw new ContainerError(messageOf(err), { status: 422 })
    }
  }

  // The containers ticked (`engine:id`), kept in the extension's data: coming back, even after the app was closed,
  // the user finds them ticked.
  async selection(): Promise<string[]> {
    const file = join(await this.dataDir(), 'selection.json')
    if (!existsSync(file)) return []
    try {
      const keys: unknown = JSON.parse(await readFile(file, 'utf8'))
      return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  async select(keys: string[]): Promise<void> {
    const file = join(await this.dataDir(), 'selection.json')
    await writeFile(`${file}.tmp`, JSON.stringify(keys))
    await rename(`${file}.tmp`, file)
  }

  #watch(engine: ContainerCli): void {
    if (this.#watching.has(engine.id)) return
    this.#watching.set(
      engine.id,
      engine.watch(() => this.tell.changed())
    )
  }

  // A page listens to `changed` (ctx.events.listened), or the last one has gone: the engines present are watched, or no
  // longer.
  async follow(listened: boolean): Promise<void> {
    if (!listened) return this.#unwatch()
    this.#listened = true
    const engines = await this.#present()
    // The page may have gone meanwhile, or the API stopped.
    if (this.#listened) for (const engine of engines) this.#watch(engine)
  }

  #unwatch(): void {
    this.#listened = false
    for (const unwatch of this.#watching.values()) unwatch()
    this.#watching.clear()
  }

  // The API stops: no engine is watched, no logs or resources followed any more.
  stop(): void {
    this.#unwatch()
    this.#follows.stopAll()
    this.#lines.clear()
    this.#usages.clear()
  }
}
