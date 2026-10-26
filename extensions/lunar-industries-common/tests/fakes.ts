import type { BranchFilter, BranchState } from '@bidule/sdk/branches'
import type { StoredObject, StoredType } from '@bidule/sdk/objects'
import type { Objects } from '../server/branches.ts'

// The core as the module sees it: two repos and the branches with their state as the core computes them, filtered as
// it does; each `setTasks` recorded (the core refuses an unknown branch or task).

const repos = [
  { id: 'r1', path: '/r/app', label: 'app' },
  { id: 'r2', path: '/r/api', label: 'api' },
]

export const state = (id: string, name: string, patch: Partial<BranchState> = {}): BranchState => {
  const repositoryId = patch.repositoryId ?? 'r1'
  const repo = repos.find((r) => r.id === repositoryId)!
  return {
    id,
    type: 'branch',
    provider: 'git',
    ref: null,
    url: null,
    properties: {},
    repositoryId,
    name,
    isDefault: false,
    ahead: 0,
    behind: 0,
    pushed: true,
    lastCommitAt: null,
    headSha: `sha-${id}`,
    base: null,
    repository: { ...repo, remoteHost: null, remotePath: null, defaultBranch: 'main' },
    tasks: [],
    manual: false,
    integration: false,
    review: null,
    pipeline: null,
    forge: null,
    ci: null,
    steps: [],
    next: null,
    ...patch,
  }
}

export function fakeCore(init: { branches?: BranchState[]; tasks?: string[]; providers?: StoredType[] } = {}) {
  const branches = init.branches ?? []
  const tasks = new Set(init.tasks ?? ['t', 'x'])
  const provided = new Set(init.providers ?? (['repository', 'branch', 'task'] as const))
  const calls: string[] = []
  const objects = {
    providers: (type: StoredType) => (provided.has(type) ? ['test'] : []),
    list: async (type: StoredType, filter: { where?: { path?: string } } = {}) =>
      type === 'repository' ? repos.filter((r) => !filter.where?.path || r.path === filter.where.path) as StoredObject<'repository'>[] : [],
    branches: async (filter: BranchFilter = {}) =>
      branches.filter(
        (b) =>
          (!filter.taskId || b.tasks.some((t) => t.id === filter.taskId)) &&
          (!filter.repositoryId || b.repositoryId === filter.repositoryId) &&
          (!filter.name || b.name === filter.name)
      ),
    setTasks: async (branchId: string, taskIds: string[]) => {
      if (!taskIds.every((t) => tasks.has(t))) throw new Error('Tâche inconnue')
      calls.push(`setTasks ${branchId} ${taskIds.join(',')}`)
    },
  }
  return { objects: objects as unknown as Objects, calls }
}
