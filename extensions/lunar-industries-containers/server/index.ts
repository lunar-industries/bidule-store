import type { Environment, ServerContext } from '@bidule/api/extensions'
import '../contract.ts'
import { ContainerCli } from './cli.ts'
import { ContainerService } from './service.ts'

// For the controller, once started (its page's first request starts it).
export let service: ContainerService
export let prepare: ServerContext['terminal']['prepare']

// Both engines, by their command line in this environment: a missing one simply lists nothing.
const enginesIn = (env: Environment) => [
  new ContainerCli('podman', 'Podman', env),
  new ContainerCli('docker', 'Docker', env),
]

const anyEngine = async (engines: ContainerCli[]) =>
  (await Promise.all(engines.map((e) => e.version()))).some((v) => v !== null)

export async function activate(ctx: ServerContext) {
  // The engines where the outside tools run; none there, on the system itself, when it is another place: on Fedora
  // Atomic the tools are in a toolbox but Podman is the host's.
  let env = ctx.env
  let engines = enginesIn(env)
  if (ctx.env.host !== ctx.env && !(await anyEngine(engines))) {
    const onHost = enginesIn(ctx.env.host)
    if (await anyEngine(onHost)) {
      env = ctx.env.host
      engines = onHost
    }
  }
  service = new ContainerService(
    engines,
    {
      changed: () => void ctx.events.emit('lunar-industries-containers.changed', {}),
      logs: (event) => void ctx.events.emit('lunar-industries-containers.logs', event),
      usage: (event) => void ctx.events.emit('lunar-industries-containers.usage', event),
    },
    () => ctx.dataDir()
  )
  // A container's shell or logs open in the terminal where the engines run: inside WSL, in the home folder there; on
  // the host when the engines are the host's (`toolbox: null`: not where the tools run); the Flatpak's host is the main
  // process's own doing.
  const where = await env.info()
  const onTheHost = env !== ctx.env
  prepare = (launch) =>
    ctx.terminal.prepare(
      where.kind === 'wsl' && where.distro
        ? { ...launch, cwd: env.toEnv(where.home), wsl: where.distro }
        : onTheHost
          ? { ...launch, toolbox: null }
          : launch
    )
}
