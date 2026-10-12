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

describe('the work as the core has it', () => {
  test('each branch with its task, and the mark of one the user unlinked by hand', async () => {
    const work = coreWork(fakeObjects(), async () => ({ linked: true }))
    expect(await work.branches()).toEqual([
      { repo: '/r/app', name: 'main', taskId: null, isDefault: true, noTask: false },
      { repo: '/r/app', name: 'feat/a', taskId: 't1', isDefault: false, noTask: false },
      { repo: '/r/app', name: 'fix/b', taskId: null, isDefault: false, noTask: true },
    ])
  })
})
