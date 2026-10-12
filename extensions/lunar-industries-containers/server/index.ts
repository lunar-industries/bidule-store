import type { ServerContext } from '@bidule/api/extensions'
import type {
  ContainerAction as DockerAction,
  ContainerDetail,
  ContainerFile,
  ContainerList,
  LogsFollow,
  UsageFollow,
} from '@bidule/ext-docker/contract'
import { Selection } from './selection.ts'

// What this module asks of Docker and Podman: the `docker` extension's actions (`client.x(a, b)` runs `docker.x`).
export type Docker = {
  list(): Promise<ContainerList>
  inspect(engine: string, id: string): Promise<ContainerDetail>
  act(engine: string, id: string, action: DockerAction): Promise<void>
  remove(engine: string, id: string): Promise<void>
  files(engine: string, id: string, path: string): Promise<ContainerFile[]>
  logs(engine: string, id: string, tail: number): Promise<LogsFollow>
  usage(): Promise<UsageFollow>
  unfollow(follow: string): Promise<void>
  // The id of the terminal session prepared (`terminal.open` opens it).
  terminal(engine: string, id: string, kind: 'shell' | 'logs'): Promise<string>
}

// For the controller, once started (its page's first request starts it).
export let docker: Docker
export let selection: Selection

export function activate(ctx: ServerContext) {
  docker = ctx.objects.client<Docker>('docker')
  selection = new Selection(() => ctx.dataDir())
}
