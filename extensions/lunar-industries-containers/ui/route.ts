import { useSyncExternalStore } from 'react'
import { navigate } from '@bidule/sdk'

// The page's path (bidule.json); a container's view is the same page with the container in its address.
export const PAGE = '/lunar-industries/conteneurs'
const PARAM = 'conteneur'

/**
 * A container's view has an address: `?conteneur=<engine>:<name>`. Its name rather than its id, so that the view
 * outlives a `docker compose up` that recreates it. The core shows a page by its path alone, so the view is the page's
 * own query; the browser's history (Alt+←, the mouse's back button) goes back to the list.
 */
export type Target = { engine: string; name: string }

const read = (): string => (location.pathname === PAGE ? (new URLSearchParams(location.search).get(PARAM) ?? '') : '')

export function parseTarget(value: string): Target | null {
  const colon = value.indexOf(':')
  if (colon <= 0 || colon === value.length - 1) return null
  return { engine: value.slice(0, colon), name: value.slice(colon + 1) }
}

const addressOf = (target: Target | null) =>
  target ? `${PAGE}?${new URLSearchParams({ [PARAM]: `${target.engine}:${target.name}` })}` : PAGE

// The container shown, or null for the list.
export function useTarget(): Target | null {
  const value = useSyncExternalStore(
    (l) => (addEventListener('popstate', l), () => removeEventListener('popstate', l)),
    read,
  )
  return parseTarget(value)
}

// Opens a container's view, from the list (Back returns there) or from anywhere (the palette).
export function openContainer(target: Target): void {
  if (location.pathname !== PAGE) return navigate(addressOf(target))
  history.pushState({ licFromList: true }, '', addressOf(target))
  // The core's router and this page listen to it.
  dispatchEvent(new PopStateEvent('popstate'))
}

// Back to the list: a step back in the history when the view was opened from it, else the list in its place.
export function backToList(): void {
  if (history.state?.licFromList) return history.back()
  history.replaceState(null, '', PAGE)
  dispatchEvent(new PopStateEvent('popstate'))
}

// The view the user left the page on (for another tab), shown again when the page comes back from its tab.
let leftOn: Target | null = null
export function leave(target: Target | null): void {
  leftOn = target
}
export function comeBack(): void {
  const target = leftOn
  leftOn = null
  if (!target || read()) return
  history.replaceState(null, '', addressOf(target))
  dispatchEvent(new PopStateEvent('popstate'))
}
