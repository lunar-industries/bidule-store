import type { ServerContext } from '@bidule/api/extensions'
import { describe, expect, test } from 'vitest'
import { coreWork } from '../server/work.ts'

// The core's objects as the module reads them: a repo, three branches, a task's link and a `noTask` mark.
function fakeObjects() {
  const repo = { id: 'r1', path: '/r/app', label: 'app' }
  const branch = (id: string, name: string, isDefault = false) => ({ id, repositoryId: 'r1', name, isDefault })
  const relations: Record<string, { from: { id: string }; to: { id: string } }[]> = {
    branch: [{ from: { id: 't1' }, to: { id: 'b1' } }],
    noTask: [{ from: { id: 'b2' }, to: { id: 'b2' } }],
  }
  const objects = {
    providers: () => ['git'],
    list: async (type: string) => (type === 'repository' ? [repo] : [branch('b0', 'main', true), branch('b1', 'feat/a'), branch('b2', 'fix/b')]),
    relations: async ({ kind }: { kind: string }) => relations[kind] ?? [],
  }
  return objects as unknown as ServerContext['objects']
}

// A day's activity: a status change on a task still there, one on a task gone to Notion's trash, a commit on the gone
// task's branch.
function objectsWithGoneTask() {
  const at = '2026-10-16T09:00:00.000Z'
  const lists: Record<string, unknown[]> = {
    activity: [
      { id: 'a1', at, kind: 'status', detail: 'En cours' },
      { id: 'a2', at, kind: 'status', detail: 'En cours' },
      { id: 'a3', at, kind: 'commit', detail: 'fix' },
    ],
    repository: [{ id: 'r1', path: '/r/app', label: 'app' }],
    branch: [{ id: 'b1', repositoryId: 'r1', name: 'feat/gone', isDefault: false }],
    task: [{ id: 't1', title: 'Là' }],
  }
  const relations = (q: { kind: string; fromType?: string }) => {
    if (q.kind === 'task') return [{ from: { id: 'a1' }, to: { id: 't1' } }, { from: { id: 'a2' }, to: { id: 'gone' } }]
    if (q.kind === 'branch' && q.fromType === 'task') return [{ from: { id: 'gone' }, to: { id: 'b1' } }]
    if (q.kind === 'branch' && q.fromType === 'activity') return [{ from: { id: 'a3' }, to: { id: 'b1' } }]
    return []
  }
  const objects = {
    providers: () => ['p'],
    list: async (type: string) => lists[type] ?? [],
    relations: async (q: { kind: string; fromType?: string }) => relations(q),
    columns: async () => [{ name: 'En cours', group: 'doing' }],
  }
  return objects as unknown as ServerContext['objects']
}

describe('the work as the core has it', () => {
  test('a task gone from its tool no longer counts: neither its status changes nor its branch’s link', async () => {
    const work = coreWork(objectsWithGoneTask(), async () => ({ linked: true }))
    const events = await work.events('2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z')
    expect(events.map((e) => [e.kind, e.taskIds])).toEqual([
      ['status', ['t1']],
      ['commit', []],
    ])
  })

  test('each branch with its task, and the mark of one the user unlinked by hand', async () => {
    const work = coreWork(fakeObjects(), async () => ({ linked: true }))
    expect(await work.branches()).toEqual([
      { repo: '/r/app', name: 'main', taskIds: [], isDefault: true, noTask: false },
      { repo: '/r/app', name: 'feat/a', taskIds: ['t1'], isDefault: false, noTask: false },
      { repo: '/r/app', name: 'fix/b', taskIds: [], isDefault: false, noTask: true },
    ])
  })
})
