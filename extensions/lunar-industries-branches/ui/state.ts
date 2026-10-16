import { useSyncExternalStore } from 'react'
import { navigate } from '@bidule/sdk'

export const PATH = '/lunar-industries/branches'

// The branch whose drawer is open, kept while the app runs: coming back, the page shows it again; a notification
// (a red CI) opens it from anywhere.
let opened: string | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))

export const useOpened = () => useSyncExternalStore(subscribe, () => opened)
export function setOpened(key: string | null): void {
  opened = key
  listeners.forEach((l) => l())
}

// A branch from anywhere: the page, its drawer open.
export function openBranch(key: string): void {
  setOpened(key)
  navigate(PATH)
}
