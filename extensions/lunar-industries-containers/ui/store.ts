import { useSyncExternalStore } from 'react'
import { on } from '@bidule/sdk'
import type { ContainerList } from '../contract.ts'
import { api, message } from './api.ts'

/**
 * The containers, read once for the whole interface: the page and the tab's counter (the background part) share one
 * reading, kept while the app runs. The engines' events (`docker.changed`) read them again, followed only once an
 * engine was found: without Docker or Podman, nobody waits for their events. Readings asked while one is under way
 * make a single one after it (`docker compose up` sends many events at once).
 */
type State = { list: ContainerList | null; error: string | null }

let state: State = { list: null, error: null }
const listeners = new Set<() => void>()
const set = (next: State) => {
  state = next
  listeners.forEach((l) => l())
}

let reading: Promise<void> | null = null
let again = false
let listening: (() => void) | null = null

export function reloadContainers(): Promise<void> {
  if (reading) {
    again = true
    return reading
  }
  reading = api
    .index({})
    .then(
      (list) => {
        set({ list, error: null })
        if (list.engines.length && !listening) listening = on('docker.changed', () => void reloadContainers())
      },
      (err) => set({ list: state.list, error: message(err) }),
    )
    .finally(() => {
      reading = null
      if (again) {
        again = false
        void reloadContainers()
      }
    })
  return reading
}

export function useContainers(): State {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
}
