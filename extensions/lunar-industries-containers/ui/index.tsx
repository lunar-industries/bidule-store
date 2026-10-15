import { useEffect } from 'react'
import { registerCommands, setPageCount, type ExtensionUi } from '@bidule/sdk'
import { ContainersPage } from './ContainersPage.tsx'
import { isFailed, titleOf } from './format.ts'
import { openContainer, PAGE } from './route.ts'
import { reloadContainers, useContainers } from './store.ts'

/**
 * Always there, whatever the page: the tab's counter (the containers that failed) and, in the palette, a command to
 * open each container's view. Both from the list the page shares (store.ts), read again on the engines' events once
 * an engine was found.
 */
function Background() {
  const { list } = useContainers()
  useEffect(() => void reloadContainers(), [])
  const containers = list?.containers ?? []
  const failed = containers.filter(isFailed).length
  useEffect(() => setPageCount(PAGE, failed || null), [failed])
  const names = containers.map((c) => `${c.engine}:${c.name}:${c.project ?? ''}:${c.service ?? ''}`).join('\n')
  useEffect(
    () =>
      registerCommands(
        ...containers.map((c) => ({
          id: `lunar-industries-containers.open:${c.engine}:${c.name}`,
          group: 'Conteneur',
          title: c.project ? `${titleOf(c)} (${c.project})` : c.name,
          detail: c.image,
          run: () => openContainer({ engine: c.engine, name: c.name }),
        })),
      ),
    // The commands change with the containers' names, not with each reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [names],
  )
  return null
}

// Simon's containers module: Docker and Podman through the `docker` extension, in place of the official page.
const ui: ExtensionUi = { pages: { containers: ContainersPage }, background: Background }
export default ui
