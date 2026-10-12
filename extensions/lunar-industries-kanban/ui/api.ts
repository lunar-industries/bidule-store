import { act, objectProviders, readTasks, run, type Board } from '@bidule/sdk'
import type { BranchRef, Branches } from '../contract.ts'

// The core's tasks and their actions (as for any Kanban), and the module's own routes over the branches
// (contract.ts). The core announces each change (`objects.changed`).
export type Loaded = Board | { source: null }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })
  // The server's answer (the routes' types are in contract.ts), or its error: `{ error }` here, `{ errors: [...] }` from
  // the validators.
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? body.errors?.[0]?.message ?? `Erreur ${res.status}`)
  return body
}

const BASE = '/api/ext/lunar-industries-kanban'

export const board = readTasks
// Its provider writes the task's new status in its tool.
export const moveTask = (id: string, status: string) => act('task', 'task.move', id, { status })
// Every provider of tasks that can reads its tool again.
export async function syncTasks() {
  const providers = (await objectProviders('task')).filter((p) => p.actions.includes('task.sync'))
  await Promise.all(providers.map((p) => run('task', 'task.sync', {}, p.id)))
}
export const branches = () => json<Branches>(`${BASE}/branches`)
export const setBranches = (taskId: string, list: BranchRef[]) =>
  json<Branches>(`${BASE}/tasks/${encodeURIComponent(taskId)}/branches`, {
    method: 'PUT',
    body: JSON.stringify({ branches: list }),
  })
export const reviewUrl = (ref: BranchRef) =>
  json<{ url: string | null }>(`${BASE}/review?${new URLSearchParams(ref).toString()}`)

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
