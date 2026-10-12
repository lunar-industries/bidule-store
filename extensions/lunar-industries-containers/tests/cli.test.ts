import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import type { Environment, EnvironmentCommand } from '@bidule/api/extensions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContainerCli, nextRetry } from '../server/cli.ts'

// The tools' environment as the engines use it: `run` answers by the command, `command` builds it as it is.
function fakeEnv(answer: (argv: string[]) => Promise<string>) {
  const ran: EnvironmentCommand[] = []
  const env = {
    run: async (command: EnvironmentCommand) => (ran.push(command), answer(command.argv)),
    command: ({ argv }: { argv: string[] }) => ({ file: argv[0], args: argv.slice(1), cwd: '/home/me' }),
  }
  return { env: env as unknown as Environment, ran }
}

// A process started by the engine: its output and its end are the test's to give.
class FakeProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill() {
    this.killed = true
    this.emit('close')
    return true
  }
}

function fakeStart() {
  const started: { argv: string[]; child: FakeProcess }[] = []
  const start = ((file: string, args: string[]) => {
    const child = new FakeProcess()
    started.push({ argv: [file, ...args], child })
    return child
  }) as unknown as typeof spawn
  return { started, start }
}

const inspected = (id: string) => ({ Id: id, Name: `/${id}`, Config: { Image: 'img' }, State: { Status: 'running' } })

describe('Lunar Industries - Conteneurs · the engines’ commands', () => {
  it('are run by the environment (ctx.env.run): the list, from ps then inspect', async () => {
    const { env, ran } = fakeEnv(async (argv) => (argv[1] === 'ps' ? 'a1\nb2\n' : JSON.stringify([inspected('a1'), inspected('b2')])))
    const names = (await new ContainerCli('docker', 'Docker', env).list()).map((c) => c.name)
    expect(names).toEqual(['a1', 'b2'])
    expect(ran.map((c) => c.argv)).toEqual([
      ['docker', 'ps', '-a', '-q', '--no-trunc'],
      ['docker', 'inspect', '--type', 'container', 'a1', 'b2'],
    ])
  })

  it('a container gone between ps and inspect: the others, from what inspect printed before failing', async () => {
    const failed = Object.assign(new Error('Command failed'), { stdout: JSON.stringify([inspected('a1')]), stderr: 'No such container: b2\n' })
    const { env } = fakeEnv(async (argv) => {
      if (argv[1] === 'ps') return 'a1\nb2\n'
      throw failed
    })
    expect((await new ContainerCli('docker', 'Docker', env).list()).map((c) => c.id)).toEqual(['a1'])
  })

  it('a refusal says what the engine wrote on stderr', async () => {
    const { env } = fakeEnv(async () => {
      throw Object.assign(new Error('Command failed: docker start x'), { stdout: '', stderr: 'Error: No such container: x\n' })
    })
    await expect(new ContainerCli('docker', 'Docker', env).act('x', 'start')).rejects.toThrow('Error: No such container: x')
  })
})

describe('Lunar Industries - Conteneurs · the engine’s events', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('listened to again ever later while the command ends at once: 10 s, then 20 s, 40 s… up to 10 min', () => {
    expect(nextRetry(null, 0)).toBe(10_000)
    expect(nextRetry(10_000, 500)).toBe(20_000)
    expect(nextRetry(20_000, 500)).toBe(40_000)
    expect(nextRetry(8 * 60_000, 500)).toBe(10 * 60_000)
    // A run that lasted: the engine was there, then restarted.
    expect(nextRetry(10 * 60_000, 2 * 60_000)).toBe(10_000)
  })

  it('docker events that ends at once is started again after 10 s, then 20 s; nothing once stopped', () => {
    vi.useFakeTimers()
    const { started, start } = fakeStart()
    const changes: number[] = []
    const stop = new ContainerCli('docker', 'Docker', fakeEnv(async () => '').env, start).watch(() => changes.push(Date.now()))
    expect(started.map((s) => s.argv.slice(0, 2))).toEqual([['docker', 'events']])
    started[0].child.emit('close')
    vi.advanceTimersByTime(9_999)
    expect(started).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(started).toHaveLength(2)
    started[1].child.emit('close')
    vi.advanceTimersByTime(19_999)
    expect(started).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(started).toHaveLength(3)
    // Several events for one change count once.
    started[2].child.stdout.emit('data', '{}\n')
    started[2].child.stdout.emit('data', '{}\n')
    vi.advanceTimersByTime(300)
    expect(changes).toHaveLength(1)
    stop()
    expect(started[2].child.killed).toBe(true)
    vi.advanceTimersByTime(60 * 60_000)
    expect(started).toHaveLength(3)
  })
})
