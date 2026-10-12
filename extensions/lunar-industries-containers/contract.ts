// Lunar Industries - Conteneurs: Simon's containers module (quack-board), an unofficial one competing with Bidule's
// own (turn that one off to use this one). Its own id, page and data; the engines are the `docker` extension's, which
// it asks through that extension's actions (and whose events, `docker.changed`, `docker.logs` and `docker.usage`, its
// page listens to): the types of containers, resources and logs are docker's, and come from its contract.

export type {
  Container,
  ContainerDetail,
  ContainerFile,
  ContainerList,
  ContainerPort,
  ContainerRow,
  ContainerState,
  LogsEvent,
  Usage,
  UsageEvent,
  UsageRow,
} from '@bidule/ext-docker/contract'

// `remove` stops a running container first (`rm -f`); its volumes stay. It is `docker.remove`; the others `docker.act`.
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number]
