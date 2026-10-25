import { act, mergedColumns, objectProviders, run, tasksNow, type Task, type TaskColumn } from '@bidule/sdk'
import type { BranchRef, Branches } from '../contract.ts'

// The core's tasks and their actions (as for any Kanban), and the module's own routes over the branches
// (contract.ts). The core announces each change (`objects.changed`).

// The board as this module reads it: the providers' titles in one line, every provider's statuses on one board (a
// status two tools share once). The core gives each provider's statuses apart (its `Board`).
export type Board = { source: string; configured: boolean; columns: TaskColumn[]; tasks: Task[] }
export type Loaded = Board | { source: null }

export async function board(): Promise<Loaded> {
  const read = await tasksNow()
  if (!read.providers.length) return { source: null }
  return {
    source: read.providers.map((p) => p.title).join(', '),
    configured: read.configured,
    columns: mergedColumns(read),
    tasks: read.tasks,
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })
  // The server's answer (the routes' types are in contract.ts), or its error: `{ error }` here, `{ errors: [...] }` from
  // the validators.
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? body.errors?.[0]?.message ?? `Erreur ${res.status}`)
  return body
}

const BASE = '/api/ext/lunar-industries-kanban'

// Its provider writes the task's new status in its tool.
export const moveTask = (id: string, status: string) => act('task', 'task.move', id, { status })
// The first of these statuses the task's tool takes (`moveCandidates`); when it takes none, the first refusal.
export async function writeMove(task: { id: string }, statuses: string[], move = moveTask) {
  let refusal: unknown = null
  for (const status of statuses) {
    try {
      return await move(task.id, status)
    } catch (err) {
      refusal ??= err
    }
  }
  throw refusal
}
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

// What to tell the user: the SDK's (« Service local injoignable » when the API does not answer).
export { errorMessage } from '@bidule/sdk'
