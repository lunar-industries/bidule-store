import type { ObjectRef, StoredObject } from '@bidule/sdk/objects'
import { describe, expect, test } from 'vitest'
import { IssueLinks, taskCited, type IssueLinksDeps } from '../server/issue_links.ts'
import { fakeForge, task } from './fakes.ts'

const ORIGIN = 'lunar-industries-branches'

const branch = (id: string, name: string, fields: Partial<StoredObject<'branch'>> = {}): StoredObject<'branch'> => ({
  id,
  type: 'branch',
  provider: 'git',
  ref: null,
  url: null,
  properties: {},
  repositoryId: 'r',
  name,
  isDefault: false,
  headSha: null,
  lastCommitAt: null,
  ...fields,
})

type Link = { from: ObjectRef; kind: string; to: ObjectRef; origin: string }

// The core's links and objects for these branches and tasks; a forge whose issues have these texts.
function world(branches: StoredObject<'branch'>[], tasks: ReturnType<typeof task>[], texts: Record<number, string>) {
  const links: Link[] = []
  const asked: number[] = []
  const { client } = fakeForge({
    issue: async (n) => (asked.push(n), n in texts ? { number: n, state: 'open', url: `u/${n}`, description: texts[n] } : null),
  })
  const objects: IssueLinksDeps['objects'] = {
    branches: async (ids) => branches.filter((b) => ids.includes(b.id)),
    tasks: async () => tasks,
    forgeOf: async () => client,
    relations: async ({ kind }) => links.filter((l) => l.kind === kind),
    link: async (from, kind, to, origin = ORIGIN) => {
      if (!links.some((l) => l.from.id === from.id && l.kind === kind && l.to.id === to.id)) links.push({ from, kind, to, origin })
    },
    unlink: async (from, kind, to, origin) => {
      const at = links.findIndex((l) => l.from.id === from.id && l.kind === kind && l.to.id === to.id && (!origin || l.origin === origin))
      if (at >= 0) links.splice(at, 1)
    },
  }
  const settings = { template: '{issue}-{slug}', integrationBranches: ['develop'] }
  const issues = new IssueLinks({ objects, settings: async () => settings, origin: ORIGIN })
  const taskOf = (branchId: string) => links.filter((l) => l.kind === 'branch' && l.to.id === branchId).map((l) => `${l.from.id}:${l.origin}`)
  return { issues, links, asked, taskOf, tasks }
}

describe('the task an issue cites', () => {
  const tasks = [task('a', 'A', { ref: 'ACC-4' }), task('b', 'B', { ref: 'ACC-42' }), task('c', 'C', { ref: null, url: 'https://notion.so/c' })]

  test('its reference as a whole word, in any case; or its page', () => {
    expect(taskCited('Tâche : acc-42 — B', tasks)?.id).toBe('b')
    expect(taskCited('Tâche : ACC-4 — A', tasks)?.id).toBe('a')
    expect(taskCited('Voir https://notion.so/c', tasks)?.id).toBe('c')
    expect(taskCited('ACC-420', tasks)).toBeNull()
  })

  test('the first one the text cites', () => {
    expect(taskCited('Suite de ACC-42, voir ACC-4', tasks)?.id).toBe('b')
  })
})

describe('a branch named after its issue', () => {
  const tasks = [task('t1', 'Ajout rôle', { ref: 'ACC-42' })]

  test('is linked to the task its issue cites, with the module as origin; the forge is asked once', async () => {
    const w = world([branch('b1', '488-ajout-role')], tasks, { 488: 'Tâche : ACC-42 — Ajout rôle' })
    await w.issues.branchesChanged(['b1'])
    await w.issues.branchesChanged(['b1'])
    expect(w.taskOf('b1')).toEqual([`t1:${ORIGIN}`])
    expect(w.asked).toEqual([488])
  })

  test('a name without an issue number, a default or integration branch, an issue the forge lacks: no link', async () => {
    const w = world(
      [branch('b1', 'feat/sans-numero'), branch('b2', '12-main', { isDefault: true }), branch('b3', 'develop'), branch('b4', '999-x')],
      tasks,
      { 12: 'ACC-42' },
    )
    await w.issues.branchesChanged(['b1', 'b2', 'b3', 'b4'])
    expect(w.links).toEqual([])
  })

  test('a task that comes after its branch is found in the text already read', async () => {
    const w = world([branch('b1', '488-ajout-role')], [], { 488: 'Tâche : ACC-42' })
    await w.issues.branchesChanged(['b1'])
    expect(w.links).toEqual([])
    w.tasks.push(...tasks)
    await w.issues.tasksChanged()
    expect(w.taskOf('b1')).toEqual([`t1:${ORIGIN}`])
    expect(w.asked).toEqual([488])
  })

  test('a link made otherwise (by hand, by its name) wins: the module takes its own away', async () => {
    const w = world([branch('b1', '488-ajout-role')], [...tasks, task('t2', 'Autre')], { 488: 'Tâche : ACC-42' })
    await w.issues.branchesChanged(['b1'])
    w.links.push({ from: { type: 'task', id: 't2' }, kind: 'branch', to: { type: 'branch', id: 'b1' }, origin: 'manual' })
    await w.issues.tasksChanged()
    expect(w.taskOf('b1')).toEqual(['t2:manual'])
  })

  test('a branch marked as having no task is left alone', async () => {
    const w = world([branch('b1', '488-ajout-role')], tasks, { 488: 'Tâche : ACC-42' })
    w.links.push({ from: { type: 'branch', id: 'b1' }, kind: 'noTask', to: { type: 'branch', id: 'b1' }, origin: 'manual' })
    await w.issues.branchesChanged(['b1'])
    expect(w.taskOf('b1')).toEqual([])
  })
})
