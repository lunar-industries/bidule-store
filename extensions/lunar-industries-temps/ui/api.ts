import { act, readTasks, type Board } from '@bidule/sdk'
import type { DaySummary, DayView, LineInput, Summary } from '../contract.ts'

// The module's routes (contract.ts lists them).
const BASE = '/api/ext/lunar-industries-temps'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })
  // The server's answer (the routes' types are in contract.ts), or its error: `{ error }` here, `{ errors: [...] }` from
  // the validators.
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? body.errors?.[0]?.message ?? `Erreur ${res.status}`)
  return body
}
const get = <T>(path: string) => json<T>(`${BASE}/${path}`)
const send = <T>(method: string, path: string, body?: unknown) =>
  json<T>(`${BASE}/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  day: (day: string) => get<DayView>(`days/${day}`),
  recompute: (day: string) => send<DayView>('POST', `days/${day}/recompute`),
  edit: (day: string) => send<DayView>('POST', `days/${day}/edit`),
  absent: (day: string) => send<DayView>('POST', `days/${day}/absent`),
  send: (day: string) => send<DayView>('POST', `days/${day}/send`),
  replace: (day: string, lines: LineInput[]) => send<DayView>('PUT', `days/${day}/draft`, { lines }),
  discard: (day: string) => send<DayView>('DELETE', `days/${day}/draft`),
  resolve: (day: string, id: string, change: { taskId?: string; confirmed?: boolean }) =>
    send<DayView>('PATCH', `days/${day}/draft/${id}`, change),
  week: (day: string) => get<{ days: DaySummary[] }>(`weeks/${day}`).then((r) => r.days),
  month: (y: number, m: number) => get<{ days: DaySummary[] }>(`months/${y}/${m + 1}`).then((r) => r.days),
  summary: () => get<Summary>('summary'),
}

// The user's tasks in the core (its `task` objects): those a line goes to, and the statuses (« passer en … »); null
// without a provider of tasks, or when they cannot be read.
export async function board(): Promise<Board | null> {
  const b = await readTasks().catch(() => null)
  return b && b.source !== null ? b : null
}

// Its provider writes a task's new status in its tool (« passer en … »).
export const moveTask = (id: string, status: string) => act('task', 'task.move', id, { status })

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))
