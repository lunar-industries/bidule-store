import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import type { Environment, EnvironmentCommand } from '@bidule/api/extensions'

// The tools' environment as the engines use it: `run` answers by the command, `command` builds it as it is.
export function fakeEnv(answer: (argv: string[]) => Promise<string>) {
  const ran: EnvironmentCommand[] = []
  const env = {
    run: async (command: EnvironmentCommand) => (ran.push(command), answer(command.argv)),
    command: ({ argv }: { argv: string[] }) => ({ file: argv[0], args: argv.slice(1), cwd: '/home/me' }),
  }
  return { env: env as unknown as Environment, ran }
}

// An output of a process the test writes to.
class FakeOutput extends EventEmitter {
  setEncoding() {
    return this
  }
}

// A process started by the engine: its outputs and its end are the test's to give; killed, it ends.
export class FakeProcess extends EventEmitter {
  stdout = new FakeOutput()
  stderr = new FakeOutput()
  killed = false
  kill() {
    this.killed = true
    this.emit('close')
    return true
  }
}

// A spawn that starts nothing: each process it was asked, with its command line.
export function fakeStart() {
  const started: { argv: string[]; child: FakeProcess }[] = []
  const start = ((file: string, args: string[]) => {
    const child = new FakeProcess()
    started.push({ argv: [file, ...args], child })
    return child
  }) as unknown as typeof spawn
  return { started, start }
}
