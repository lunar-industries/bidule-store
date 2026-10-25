import { useSyncExternalStore } from 'react'

export const PATH = '/lunar-industries/branches'

// The branch whose drawer is open, kept while the app runs: coming back, the page shows it again.
let opened: string | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))

export const useOpened = () => useSyncExternalStore(subscribe, () => opened)
export function setOpened(key: string | null): void {
  opened = key
  listeners.forEach((l) => l())
}
