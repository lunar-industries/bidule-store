import { busy, execute, react, toast } from '@bidule/sdk'
import { confirm } from '@bidule/ext-lunar-industries-common/ui/confirm'
import type { MenuEntry } from '@bidule/ext-lunar-industries-common/ui/menu'
import type {} from '@bidule/ext-terminal/contract'
import type { ContainerAction, ContainerRow } from '../contract.ts'
import { api, message } from './api.ts'
import { isUp, portsOf, portUrl } from './format.ts'
import { reloadContainers } from './store.ts'

// What the list and a container's view do with containers: act on one or several, open a terminal on one, copy what
// it is called, remove them; and the entries of their menus, the same wherever a menu opens.

const DOING: Record<ContainerAction, string> = {
  start: 'démarrer',
  stop: 'arrêter',
  restart: 'redémarrer',
  remove: 'supprimer',
}

const panic = (text: string) => react('panic', text, text)

// One container: the mascot says why when it fails; true when it went through.
export async function act(c: ContainerRow, action: ContainerAction): Promise<boolean> {
  try {
    await busy(api.act({ params: { engine: c.engine, id: c.id }, body: { action } }))
    void reloadContainers()
    return true
  } catch (err) {
    panic(`${c.name} : ${message(err)}`)
    return false
  }
}

/**
 * The same action on several containers at once: the list is read again once, after all of them, and what failed is
 * said in a single message rather than one per container.
 */
export async function actMany(targets: ContainerRow[], action: ContainerAction): Promise<boolean> {
  if (!targets.length) return true
  if (targets.length === 1) return act(targets[0], action)
  const results = await busy(
    Promise.allSettled(targets.map((c) => api.act({ params: { engine: c.engine, id: c.id }, body: { action } }))),
  )
  void reloadContainers()
  const failed = targets.flatMap((c, i) => {
    const r = results[i]
    return r.status === 'rejected' ? [`${c.name} (${message(r.reason)})`] : []
  })
  if (failed.length)
    panic(`${failed.length} sur ${targets.length} n’ont pas pu ${DOING[action]} : ${failed.join(', ')}`)
  return !failed.length
}

// A terminal tab on the container (the `terminal` role): a shell inside, or its logs.
export async function openTerminal(c: ContainerRow, kind: 'shell' | 'logs'): Promise<void> {
  try {
    const { session } = await api.terminal({ params: { engine: c.engine, id: c.id }, body: { kind } })
    await execute('terminal.open', { session, title: kind === 'logs' ? `Journaux · ${c.name}` : c.name })
  } catch (err) {
    panic(`${c.name} : ${message(err)}`)
  }
}

// `done` is the notice once copied: « Nom copié ».
export function copy(text: string, done: string): Promise<void> {
  return navigator.clipboard.writeText(text).then(
    () => toast(done),
    () => panic('Impossible de copier'),
  )
}

// Removing asks first, however many (the common confirmation, the focus on « Annuler »): it cannot be undone, and a
// running container is stopped to go.
export function confirmRemove(targets: ContainerRow[]): Promise<boolean> {
  const [first] = targets
  if (!first) return Promise.resolve(false)
  const many = targets.length > 1
  return confirm({
    title: many ? `Supprimer ${targets.length} conteneurs ?` : `Supprimer ${first.name} ?`,
    text:
      (targets.some(isUp) ? (many ? 'Ceux qui sont en marche seront arrêtés d’abord. ' : 'Il sera arrêté d’abord. ') : '') +
      (many ? 'Leurs volumes sont conservés.' : 'Ses volumes sont conservés.'),
    action: 'Supprimer',
    danger: true,
  })
}

export async function removeMany(targets: ContainerRow[]): Promise<boolean> {
  if (!(await confirmRemove(targets))) return false
  return actMany(targets, 'remove')
}

const NOT_RUNNING = 'Le conteneur doit être en marche'

/**
 * A container's own entries, in its menu: from the list, `open` and `logs` lead to its view; `removed` follows a
 * removal (the view goes back to the list).
 */
export function containerEntries(
  c: ContainerRow,
  { terminal, open, logs, removed }: { terminal: boolean; open?: () => void; logs?: () => void; removed?: () => void },
): MenuEntry[] {
  const ports = portsOf(c.ports)
  return [
    open && { label: 'Voir la fiche', run: open, shortcut: 'Entrée' },
    logs && { label: 'Voir les journaux', run: logs },
    terminal && { label: 'Ouvrir un shell', run: () => openTerminal(c, 'shell'), disabled: c.state === 'running' ? false : NOT_RUNNING },
    terminal && { label: 'Journaux dans le Terminal', run: () => openTerminal(c, 'logs') },
    'separator',
    !isUp(c) && { label: 'Démarrer', run: () => act(c, 'start') },
    isUp(c) && { label: 'Redémarrer', run: () => act(c, 'restart') },
    isUp(c) && { label: 'Arrêter', run: () => act(c, 'stop') },
    'separator',
    ...ports.flatMap((p): MenuEntry[] => {
      const url = portUrl(c, p)
      return url ? [{ label: `Copier ${url.replace(/^http:\/\//, '')}`, run: () => copy(url, 'Adresse copiée') }] : []
    }),
    { label: 'Copier le nom', run: () => copy(c.name, 'Nom copié') },
    { label: 'Copier l’identifiant', run: () => copy(c.id, 'Identifiant copié') },
    'separator',
    { label: 'Supprimer…', run: async () => (await removeMany([c])) && removed?.(), shortcut: 'Suppr' },
  ]
}

const several = (n: number) => `${n} conteneur${n > 1 ? 's' : ''}`

// The entries for the containers ticked, first in a ticked row's menu when there are several.
export function tickedEntries(ticked: ContainerRow[], untick: () => void): MenuEntry[] {
  const down = ticked.filter((c) => !isUp(c))
  const up = ticked.filter(isUp)
  return [
    { label: `Démarrer ${down.length === ticked.length ? 'les ' : ''}${several(down.length)}`, run: () => actMany(down, 'start'), disabled: !down.length },
    { label: `Redémarrer ${up.length === ticked.length ? 'les ' : ''}${several(up.length)}`, run: () => actMany(up, 'restart'), disabled: !up.length },
    { label: `Arrêter ${up.length === ticked.length ? 'les ' : ''}${several(up.length)}`, run: () => actMany(up, 'stop'), disabled: !up.length },
    { label: `Supprimer les ${several(ticked.length)}…`, run: () => removeMany(ticked) },
    { label: 'Tout décocher', run: untick, shortcut: 'Échap' },
  ]
}

// A project's entries, in its header's menu: on all its containers, whatever the filter shows.
export function projectEntries(
  containers: ContainerRow[],
  { ticked, tick }: { ticked: boolean; tick: (on: boolean) => void },
): MenuEntry[] {
  const down = containers.filter((c) => !isUp(c))
  const up = containers.filter(isUp)
  return [
    { label: 'Tout démarrer', run: () => actMany(down, 'start'), disabled: !down.length },
    { label: 'Tout redémarrer', run: () => actMany(containers, 'restart') },
    { label: 'Tout arrêter', run: () => actMany(up, 'stop'), disabled: !up.length },
    'separator',
    { label: ticked ? 'Décocher le projet' : 'Cocher le projet', run: () => tick(!ticked) },
    'separator',
    { label: `Supprimer les ${several(containers.length)}…`, run: () => removeMany(containers) },
  ]
}
