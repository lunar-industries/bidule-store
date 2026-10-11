import { describe, expect, it } from 'vitest'
import type { ServerContext } from '@bidule/api/extensions'
import type { Task } from '@bidule/sdk/tasks'
import { taskAccess } from '../server/objects.ts'

// The core's tasks as the sessions read them (ctx.objects): two providers sharing a status, a task the user is not on,
// and a provider that neither shows a page nor takes comments.

const task = (patch: Partial<Task>): Task => ({
  id: 't1',
  type: 'task',
  provider: 'notion',
  ref: null,
  url: null,
  properties: {},
  title: 'Tâche',
  status: 'À faire',
  group: 'todo',
  role: 'owner',
  due: null,
  lastEdited: null,
  ...patch,
})

function fakeCtx(options: { providers?: string[] } = {}) {
  const tasks = [
    task({ id: 't1', ref: 'ID-7', title: 'Ajout rôle' }),
    task({ id: 't2', ref: 'ID-8', title: 'Pas à moi', role: null }),
    task({ id: 't3', ref: 'PL-1', title: 'Chez Plane', provider: 'plane' }),
  ]
  const acted: string[] = []
  const providers = options.providers ?? ['notion', 'plane']
  const answering: Record<string, string[]> = { 'task.page': ['notion'], 'task.comment': ['notion'], 'task.search': ['notion'] }
  const objects = {
    providers: (_type: string, action?: string) => (action ? (answering[action] ?? []) : providers),
    columns: async () => [
      { name: 'À faire', color: 'neutral', group: 'todo', provider: 'notion' },
      { name: 'À faire', color: 'neutral', group: 'todo', provider: 'plane' },
      { name: 'En cours', color: 'blue', group: 'doing', provider: 'notion' },
    ],
    list: async (_type: string, filter: { ids?: string[] } = {}) => tasks.filter((t) => !filter.ids || filter.ids.includes(t.id)),
    get: async (_type: string, id: string) => tasks.find((t) => t.id === id) ?? null,
    act: async (action: string, id: string, args: unknown) => {
      acted.push(`${action} ${id} ${JSON.stringify(args)}`)
      return action === 'task.page' ? { text: 'Contenu', comments: [] } : undefined
    },
    run: async (_action: string, { q }: { q: string }) => (q === 'rôle' ? ['t1', 't2'] : []),
  }
  return { ctx: { objects } as unknown as ServerContext, acted }
}

describe('the core’s tasks', () => {
  it('none without a provider of tasks', () => {
    expect(taskAccess(fakeCtx({ providers: [] }).ctx)).toBeNull()
  })

  it('the board: the user’s tasks, a status two tools share as one column', async () => {
    const board = await taskAccess(fakeCtx().ctx)?.board()
    expect(board?.columns.map((c) => c.name)).toEqual(['À faire', 'En cours'])
    expect(board?.tasks.map((t) => t.id)).toEqual(['t1', 't3'])
  })

  it('finds a task by its id or its reference in any case, the user’s or not', async () => {
    const tasks = taskAccess(fakeCtx().ctx)
    expect((await tasks?.find('t3'))?.title).toBe('Chez Plane')
    expect((await tasks?.find(' id-7 '))?.id).toBe('t1')
    expect((await tasks?.find('ID-8'))?.id).toBe('t2')
    expect(await tasks?.find('ID-99')).toBeNull()
  })

  it('searches the tools that search', async () => {
    const found = await taskAccess(fakeCtx().ctx)?.search('rôle')
    expect(found?.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('a page and a comment go to the task’s provider, when it answers them', async () => {
    const { ctx, acted } = fakeCtx()
    const tasks = taskAccess(ctx)
    expect(await tasks?.page('t1')).toEqual({ text: 'Contenu', comments: [] })
    expect(await tasks?.page('t3')).toEqual({ text: '', comments: [] })
    await tasks?.comment('t1', 'Vu')
    await expect(tasks?.comment('t3', 'Vu')).rejects.toThrow('La source de tâches ne prend pas de commentaires')
    await tasks?.move('t3', 'En cours')
    expect(acted).toEqual(['task.page t1 {}', 'task.comment t1 {"text":"Vu"}', 'task.move t3 {"status":"En cours"}'])
  })
})
