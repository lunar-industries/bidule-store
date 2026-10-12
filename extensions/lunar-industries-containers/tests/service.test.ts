import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Environment } from '@bidule/api/extensions'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Container, ContainerAction } from '../contract.ts'
import { ContainerCli } from '../server/cli.ts'
import { ContainerService } from '../server/service.ts'

// An engine that answers what it is given, instead of running a command line.
class FakeEngine extends ContainerCli {
  acts: string[] = []
  watched = 0
  unwatched = 0
  constructor(
    cli: 'docker' | 'podman',
    public present: boolean,
    private containers: Container[] | Error
  ) {
    super(cli, cli === 'docker' ? 'Docker' : 'Podman', {} as unknown as Environment)
  }
  override async isConfigured() {
    return this.present
  }
  override async list() {
    if (this.containers instanceof Error) throw this.containers
    return this.containers
  }
  override async act(id: string, action: ContainerAction) {
    this.acts.push(`${action} ${id}`)
  }
  override watch() {
    this.watched++
    return () => void this.unwatched++
  }
}

const container = (name: string): Container => ({
  id: `${name}-id`,
  name,
  image: 'img',
  state: 'running',
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  project: null,
  service: null,
  ports: [],
})

describe('Lunar Industries - Conteneurs · the service', () => {
  let dir: string
  let changes: number
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lic-containers-'))
    changes = 0
  })
  const service = (...engines: FakeEngine[]) =>
    new ContainerService(engines, { changed: () => void changes++, logs: () => {}, usage: () => {} }, async () => dir)

  it('lists the containers of every engine present, by name, and leaves an absent engine out', async () => {
    const podman = new FakeEngine('podman', true, [container('web')])
    const docker = new FakeEngine('docker', true, [container('api'), container('db')])
    const absent = new FakeEngine('docker', false, [container('ghost')])
    const list = await service(podman, docker).list()
    expect(list.engines).toEqual([
      { id: 'podman', name: 'Podman' },
      { id: 'docker', name: 'Docker' },
    ])
    expect(list.containers.map((c) => `${c.engine}:${c.name}`)).toEqual(['docker:api', 'docker:db', 'podman:web'])
    expect((await service(absent).list()).engines).toEqual([])
  })

  it('an engine that does not answer is named in the errors, the others still list', async () => {
    const list = await service(new FakeEngine('podman', true, new Error('Cannot connect')), new FakeEngine('docker', true, [container('api')])).list()
    expect(list.errors).toEqual([{ engine: 'Podman', message: 'Cannot connect' }])
    expect(list.containers.map((c) => c.name)).toEqual(['api'])
  })

  it('the engines’ events are watched only while a page listens, each engine once', async () => {
    const podman = new FakeEngine('podman', true, [])
    const s = service(podman)
    await s.list()
    expect(podman.watched).toBe(0)
    await s.follow(true)
    await s.list()
    await s.follow(true)
    expect(podman.watched).toBe(1)
    await s.follow(false)
    expect(podman.unwatched).toBe(1)
    await s.list()
    expect(podman.watched).toBe(1)
    await s.follow(true)
    expect(podman.watched).toBe(2)
  })

  it('an engine that appears while a page listens is watched from the next listing', async () => {
    const podman = new FakeEngine('podman', false, [])
    const s = service(podman)
    await s.follow(true)
    expect(podman.watched).toBe(0)
    podman.present = true
    await s.list()
    expect(podman.watched).toBe(1)
  })

  it('stopping watches no engine any more, whatever the page', async () => {
    const podman = new FakeEngine('podman', true, [])
    const s = service(podman)
    await s.follow(true)
    s.stop()
    expect(podman.unwatched).toBe(1)
    await s.list()
    expect(podman.watched).toBe(1)
  })

  it('an action goes to the engine asked, tells the page, and refuses an id that could pass for an option', async () => {
    const podman = new FakeEngine('podman', true, [container('web')])
    const s = service(podman)
    await s.act('podman', 'web-id', 'stop')
    expect(podman.acts).toEqual(['stop web-id'])
    expect(changes).toBe(1)
    await expect(s.act('podman', '--all', 'remove')).rejects.toThrow(/inconnu/)
    await expect(s.act('nerdctl', 'web-id', 'stop')).rejects.toThrow(/introuvable/)
    expect(podman.acts).toEqual(['stop web-id'])
  })

  it('opens a shell or the logs through the engine’s own command, in the given folder', async () => {
    const s = service(new FakeEngine('docker', true, []))
    expect(await s.launch('docker', 'web-id', 'logs', '/home/me')).toEqual({
      argv: ['docker', 'logs', '--follow', '--tail', '500', 'web-id'],
      cwd: '/home/me',
    })
    const shell = await s.launch('docker', 'web-id', 'shell', '/home/me')
    expect(shell.argv.slice(0, 4)).toEqual(['docker', 'exec', '-it', 'web-id'])
  })

  it('keeps the containers ticked, even after a restart', async () => {
    const first = service()
    expect(await first.selection()).toEqual([])
    await first.select(['podman:web-id', 'docker:db-id'])
    expect(await service().selection()).toEqual(['podman:web-id', 'docker:db-id'])
  })
})
