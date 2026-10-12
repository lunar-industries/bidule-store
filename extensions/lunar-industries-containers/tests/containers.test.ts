import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import { beforeEach, describe, expect, it } from 'vitest'
import ContainersController from '../server/controllers/containers_controller.ts'
import { activate } from '../server/index.ts'

// What the module asks of `docker`, and what it answers: the engines are docker's own (tested there).
let calls: [string, ...unknown[]][]
let asked: string[]
const answers: Record<string, unknown> = {
  list: { engines: [], containers: [], errors: [] },
  usage: { follow: 'u1', usage: null },
  inspect: { id: 'web' },
  logs: { follow: 'l1', lines: ['a'] },
  files: [{ name: 'etc', directory: true }],
  terminal: 'session-1',
}
const docker = new Proxy(
  {},
  {
    get:
      (_, name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args])
        return Promise.resolve(answers[name])
      },
  }
)

// The module started, on the given data folder (the same one to start it again).
const start = (dir: string) => {
  asked = []
  activate({
    objects: {
      client: (extension: string) => {
        asked.push(extension)
        return docker
      },
    },
    dataDir: async () => dir,
  } as never)
}

// What the controller reads of a request: its route parameters and the validated body.
const request = (params: Record<string, string>, body: unknown = {}) =>
  ({ params, request: { validateUsing: (validator: { validate(data: unknown): unknown }) => validator.validate(body) } }) as unknown as HttpContext

describe('Lunar Industries - Conteneurs · through docker', () => {
  let dir: string
  beforeEach(async () => {
    calls = []
    dir = await mkdtemp(join(tmpdir(), 'lic-containers-'))
    start(dir)
  })

  it('asks the engines of the docker extension, and nothing else', () => {
    expect(asked).toEqual(['docker'])
  })

  it('lists, reads one container and follows the resources by docker’s actions', async () => {
    const containers = new ContainersController()
    expect(await containers.index()).toBe(answers.list)
    expect(await containers.show(request({ engine: 'docker', id: 'web' }))).toBe(answers.inspect)
    expect(await containers.followUsage()).toBe(answers.usage)
    expect(calls).toEqual([['list'], ['inspect', 'docker', 'web'], ['usage']])
  })

  it('start, stop and restart are docker.act; remove is docker.remove', async () => {
    const containers = new ContainersController()
    for (const action of ['start', 'stop', 'restart', 'remove'])
      expect(await containers.act(request({ engine: 'podman', id: 'db' }, { action }))).toEqual({ ok: true })
    expect(calls).toEqual([
      ['act', 'podman', 'db', 'start'],
      ['act', 'podman', 'db', 'stop'],
      ['act', 'podman', 'db', 'restart'],
      ['remove', 'podman', 'db'],
    ])
  })

  it('an action that is none of those is refused before docker is asked', async () => {
    await expect(new ContainersController().act(request({ engine: 'docker', id: 'db' }, { action: 'prune' }))).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('a terminal is the session docker prepared; the logs start with their last 500 lines, then follow', async () => {
    const containers = new ContainersController()
    expect(await containers.terminal(request({ engine: 'docker', id: 'web' }, { kind: 'shell' }))).toEqual({ session: 'session-1' })
    expect(await containers.followLogs(request({ engine: 'docker', id: 'web' }))).toBe(answers.logs)
    expect(calls).toEqual([
      ['terminal', 'docker', 'web', 'shell'],
      ['logs', 'docker', 'web', 500],
    ])
  })

  it('stops a follow by its id; a follow’s id that is not one is refused', async () => {
    const containers = new ContainersController()
    expect(await containers.unfollow(request({}, { params: { follow: 'l1' } }))).toEqual({ ok: true })
    await expect(containers.unfollow(request({}, { params: { follow: '../x' } }))).rejects.toThrow()
    expect(calls).toEqual([['unfollow', 'l1']])
  })

  it('lists a folder of the container, which must start at its root', async () => {
    const containers = new ContainersController()
    expect(await containers.files(request({ engine: 'docker', id: 'web' }, { path: '/' }))).toEqual({ files: answers.files })
    await expect(containers.files(request({ engine: 'docker', id: 'web' }, { path: 'etc' }))).rejects.toThrow()
    expect(calls).toEqual([['files', 'docker', 'web', '/']])
  })

  it('keeps the containers ticked, even after a restart', async () => {
    const first = new ContainersController()
    expect(await first.selection()).toEqual({ keys: [] })
    await first.select(request({}, { keys: ['podman:web-id', 'docker:db-id'] }))
    start(dir)
    expect(await new ContainersController().selection()).toEqual({ keys: ['podman:web-id', 'docker:db-id'] })
  })
})
