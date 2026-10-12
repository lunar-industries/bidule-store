import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogsEvent, UsageEvent } from '../contract.ts'
import { ContainerCli } from '../server/cli.ts'
import { Follows, MAX_FOLLOWS } from '../server/follow.ts'
import { ContainerService } from '../server/service.ts'
import { fakeEnv, fakeStart } from './fakes.ts'

// Docker, there; the long commands it starts are the test's (fakeStart).
function setup() {
  const { started, start } = fakeStart()
  const { env } = fakeEnv(async (argv) => (argv[1] === '--version' ? 'Docker version 29.8.2' : ''))
  const told: LogsEvent[] = []
  const service = new ContainerService(
    [new ContainerCli('docker', 'Docker', env, start)],
    { changed: () => {}, logs: (event) => void told.push(event), usage: () => {} },
    async () => '/tmp'
  )
  return { service, started, told }
}

describe('Lunar Industries - Conteneurs · stopping with the API', () => {
  it('ends the logs and the resources followed, whoever still follows them', async () => {
    const { service, started } = setup()
    await service.followLogs('docker', 'web')
    await service.followLogs('docker', 'db')
    await service.followUsage()
    expect(started).toHaveLength(3)
    service.stop()
    expect(started.every((s) => s.child.killed)).toBe(true)
  })
})

describe('Lunar Industries - Conteneurs · a container’s logs, followed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('two follows of the same container share one process, which the last to leave stops', async () => {
    const { service, started } = setup()
    const a = await service.followLogs('docker', 'web')
    const b = await service.followLogs('docker', 'web')
    expect(b.follow).toBe(a.follow)
    expect(started.map((s) => s.argv)).toEqual([['docker', 'logs', '--follow', '--timestamps', '--tail', '500', 'web']])
    service.unfollow(a.follow)
    expect(started[0].child.killed).toBe(false)
    service.unfollow(b.follow)
    expect(started[0].child.killed).toBe(true)
  })

  it(`a follow beyond ${MAX_FOLLOWS} stops the oldest, which says it ended`, async () => {
    const { service, started, told } = setup()
    const follows = []
    for (const id of ['a', 'b', 'c', 'd', 'e']) follows.push((await service.followLogs('docker', id)).follow)
    expect(started.map((s) => s.child.killed)).toEqual([true, false, false, false, false])
    expect(told).toEqual([{ follow: follows[0], lines: [], ended: true }])
  })

  it('the lines of both outputs come together, in the order of their times; the end of the process is said', async () => {
    const { service, started, told } = setup()
    const { follow, lines } = await service.followLogs('docker', 'web')
    expect(lines).toEqual([])
    const child = started[0].child
    child.stdout.emit('data', '2026-10-12T05:03:48.394512698Z Mon Oct 12 05:03:48 UTC 2026\n2026-10-12T05:03:49.39')
    child.stderr.emit('data', '2026-10-12T05:03:48.394610204Z oops\n')
    child.stdout.emit('data', '6211672Z Mon Oct 12 05:03:49 UTC 2026\n')
    vi.advanceTimersByTime(100)
    expect(told).toEqual([
      {
        follow,
        lines: [
          '2026-10-12T05:03:48.394512698Z Mon Oct 12 05:03:48 UTC 2026',
          '2026-10-12T05:03:48.394610204Z oops',
          '2026-10-12T05:03:49.396211672Z Mon Oct 12 05:03:49 UTC 2026',
        ],
        ended: false,
      },
    ])
    // Another view that joins gets what was read so far.
    expect((await service.followLogs('docker', 'web')).lines).toHaveLength(3)
    // The container removed: its last words, then the end.
    child.stderr.emit('data', '2026-10-12T05:03:50.1Z bye')
    child.emit('close')
    expect(told.slice(1)).toEqual([
      { follow, lines: ['2026-10-12T05:03:50.1Z bye'], ended: false },
      { follow, lines: [], ended: true },
    ])
    // Ended: a new request starts a new process.
    await service.followLogs('docker', 'web')
    expect(started).toHaveLength(2)
  })

  it('an unknown engine or a container id that could pass for an option is refused', async () => {
    const { service, started } = setup()
    await expect(service.followLogs('podman', 'web')).rejects.toMatchObject({ status: 404 })
    await expect(service.followLogs('docker', '--privileged')).rejects.toMatchObject({ status: 404 })
    expect(started).toEqual([])
  })
})

describe('Lunar Industries - Conteneurs · the resources, followed', () => {
  it('each measure of the engine, with the machine’s cores and memory; one follow for every view; its end said', async () => {
    const { started, start } = fakeStart()
    const { env } = fakeEnv(async (argv) => (argv[1] === '--version' ? 'Docker version 29.8.2' : argv[1] === 'info' ? '8|16000000000\n' : ''))
    const told: UsageEvent[] = []
    const service = new ContainerService(
      [new ContainerCli('docker', 'Docker', env, start)],
      { changed: () => {}, logs: () => {}, usage: (event) => void told.push(event) },
      async () => '/tmp'
    )
    const first = await service.followUsage()
    expect(first.usage).toBeNull()
    expect(started.map((s) => s.argv.slice(0, 2))).toEqual([['docker', 'stats']])
    started[0].child.stdout.emit('data', '\u001b[Hd84e636c3e36|0.15%|3.633MiB / 15.58GiB\u001b[K\n\u001b[J')
    const row = { engine: 'docker', id: 'd84e636c3e36', cpu: 0.15, memory: Math.round(3.633 * 1024 ** 2), limit: Math.round(15.58 * 1024 ** 3) }
    const usage = { cpus: 8, memory: 16000000000, containers: [row] }
    expect(told).toEqual([{ follow: first.follow, usage, ended: false }])
    // Another view joins: the same follow, the last measure at once.
    expect(await service.followUsage()).toEqual({ follow: first.follow, usage })
    expect(started).toHaveLength(1)
    started[0].child.emit('close')
    expect(told.at(-1)).toEqual({ follow: first.follow, usage: null, ended: true })
  })
})

describe('Lunar Industries - Conteneurs · the follows', () => {
  it('a follow that cannot start takes no place: the next request starts it again', () => {
    const follows = new Follows()
    expect(() =>
      follows.join('logs a', () => {
        throw new Error('spawn failed')
      })
    ).toThrow('spawn failed')
    let started = 0
    follows.join('logs a', () => (started++, () => {}))
    expect(started).toBe(1)
  })

  it('without any engine, the resources have nothing to follow, and take no place', async () => {
    const { started, start } = fakeStart()
    const { env } = fakeEnv(async () => {
      throw new Error('no engine')
    })
    const service = new ContainerService(
      [new ContainerCli('docker', 'Docker', env, start)],
      { changed: () => {}, logs: () => {}, usage: () => {} },
      async () => '/tmp'
    )
    expect(await service.followUsage()).toEqual({ follow: null, usage: null })
    expect(started).toEqual([])
  })
})
