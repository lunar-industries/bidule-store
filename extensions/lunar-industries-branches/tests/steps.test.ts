import { describe, expect, test } from 'vitest'
import { actionOf, countsOf, orphansOf, reposOf, rowOf, sortRows, stateOf, stepOf } from '../ui/steps.ts'
import { listed, task } from './fakes.ts'

describe('a branch’s step', () => {
  test('a task, then a review, then its CI, then the merge', () => {
    expect(stepOf(listed({ name: 'a' }))).toBe('task')
    expect(stepOf(listed({ name: 'a', taskId: 't' }))).toBe('review')
    expect(stepOf(listed({ name: 'a', taskId: 't', forge: null, reviewNumber: 3 }))).toBe('review')
    expect(stepOf(listed({ name: 'a', taskId: 't', reviewNumber: 3, reviewState: 'closed' }))).toBe('review')
    expect(stepOf(listed({ name: 'a', taskId: 't', reviewNumber: 3, reviewState: 'open', ci: 'fail' }))).toBe('ci')
    expect(stepOf(listed({ name: 'a', taskId: 't', reviewNumber: 3, reviewState: 'open', ci: 'ok' }))).toBe('merge')
    expect(stepOf(listed({ name: 'a', taskId: 't', reviewState: 'merged' }))).toBe('done')
  })

  test('what the table says of it, and whether it waits for the user', () => {
    const say = (b: ReturnType<typeof listed>) => stateOf(b, stepOf(b), 'MR')
    const open = { taskId: 't', reviewNumber: 3, reviewState: 'open' as const }
    expect(say(listed({ name: 'a' }))).toEqual({ text: 'Sans tâche', tone: 'warn', yours: true })
    expect(say(listed({ name: 'a', taskId: 't', forge: null })).text).toBe('Liée, sans forge')
    expect(say(listed({ name: 'a', taskId: 't', pushed: false })).text).toBe('À pousser')
    expect(say(listed({ name: 'a', taskId: 't' })).text).toBe('À proposer')
    expect(say(listed({ name: 'a', ...open, reviewState: 'closed' })).text).toBe('MR fermée')
    expect(say(listed({ name: 'a', ...open, ci: 'fail' }))).toEqual({ text: 'CI rouge', tone: 'bad', yours: true })
    expect(say(listed({ name: 'a', ...open, ci: 'pending' }))).toEqual({ text: 'CI en cours', tone: 'info', yours: false })
    expect(say(listed({ name: 'a', ...open, ci: 'ok', reviewDraft: true })).text).toBe('MR en brouillon')
    expect(say(listed({ name: 'a', ...open, ci: 'ok', reviewDraft: false })).text).toBe('Prête à fusionner')
    // Its draft not read yet: never « ready to merge ».
    expect(say(listed({ name: 'a', ...open, ci: 'ok', reviewDraft: null })).text).toBe('Revue ouverte')
  })

  test('the one thing to do now', () => {
    const act = (b: ReturnType<typeof listed>) => actionOf(b, stepOf(b), 'MR').kind
    const open = { taskId: 't', reviewNumber: 3, reviewState: 'open' as const }
    expect(act(listed({ name: 'a' }))).toBe('link')
    expect(act(listed({ name: 'a', taskId: 't', pushed: false }))).toBe('push')
    expect(act(listed({ name: 'a', taskId: 't' }))).toBe('review')
    expect(act(listed({ name: 'a', taskId: 't', forge: null }))).toBe('open')
    expect(act(listed({ name: 'a', ...open, ci: 'fail' }))).toBe('retry')
    expect(act(listed({ name: 'a', ...open, ci: 'pending' }))).toBe('open')
    expect(act(listed({ name: 'a', ...open, ci: 'ok', reviewDraft: true }))).toBe('ready')
    expect(act(listed({ name: 'a', ...open, ci: 'ok', reviewDraft: false }))).toBe('merge')
    expect(act(listed({ name: 'a', ...open, ci: 'ok', reviewDraft: null }))).toBe('open')
  })

  test('the steps reached, and the review named after its forge', () => {
    const r = rowOf(listed({ name: 'a', taskId: 't', reviewNumber: 3, reviewState: 'open', ci: 'fail', forge: 'github' }), [task('t', 'T')])
    expect(r.progress).toEqual([true, true, false, false])
    expect(r.steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo'])
    expect(r.reviewLabel).toBe('PR #3')
    expect(r.forgeName).toBe('GitHub')
    expect(r.task?.title).toBe('T')
    expect(rowOf(listed({ name: 'b', reviewNumber: 4 }), []).reviewLabel).toBe('MR !4')
  })
})

describe('the table', () => {
  const listing = {
    branches: [
      listed({ name: 'old', reviewState: 'merged', taskId: 't' }),
      listed({ name: 'new' }),
      listed({ name: 'x', repo: '/r/lib', repoLabel: 'lib', taskId: 't' }),
    ],
    repos: [
      { path: '/r/app', label: 'app', forge: 'gitlab' as const, targets: ['main', 'develop'], reviewTarget: null },
      { path: '/r/lib', label: 'lib', forge: null, targets: ['main'], reviewTarget: 'main' },
      { path: '/r/empty', label: 'empty', forge: null, targets: [], reviewTarget: null },
    ],
    defaultTarget: 'develop',
  }

  test('by repo, as the filter says; the settings’ target when the repo has it', () => {
    const repos = reposOf(listing, [], 'current')
    expect(repos.map((r) => r.path)).toEqual(['/r/app', '/r/lib', '/r/empty'])
    expect(repos[0].rows.map((r) => r.name)).toEqual(['new'])
    expect(repos[0].target).toBe('develop')
    expect(repos[1].target).toBe('main')
    expect(repos[2].rows).toEqual([])
    expect(reposOf(listing, [], 'orphans').flatMap((r) => r.rows.map((x) => x.name))).toEqual(['new'])
    expect(reposOf(listing, [], 'all')[0].rows.map((r) => r.name).sort()).toEqual(['new', 'old'])
    expect(countsOf(listing.branches)).toEqual({ current: 2, orphans: 1, all: 3 })
  })

  test('a search in the name, the repo, the task', () => {
    const tasks = [task('t', 'Écran de connexion', { ref: 'TSK-4' })]
    const names = (q: string) => reposOf(listing, tasks, 'all', 'name', q).flatMap((r) => r.rows.map((x) => x.name))
    expect(names('ecran')).toEqual(['old', 'x'])
    expect(names('lib')).toEqual(['x'])
    expect(names('tsk-4 lib')).toEqual(['x'])
  })

  test('what waits for the user first: a red CI, then the rest of their moves, then what the forge is doing', () => {
    const open = { taskId: 't', reviewNumber: 3, reviewState: 'open' as const }
    const rows = [
      listed({ name: 'pending', ...open, ci: 'pending' }),
      listed({ name: 'ready', ...open, ci: 'ok', reviewDraft: false }),
      listed({ name: 'orphan' }),
      listed({ name: 'red', ...open, ci: 'fail' }),
    ].map((b) => rowOf(b, []))
    expect(sortRows(rows, 'state').map((r) => r.name)).toEqual(['red', 'orphan', 'ready', 'pending'])
    expect(sortRows(rows, 'name').map((r) => r.name)).toEqual(['orphan', 'pending', 'ready', 'red'])
  })

  test('the recent branches without a task', () => {
    const now = Date.now()
    const stale = listed({ name: 's', lastCommitAt: new Date(now - 20 * 864e5).toISOString() })
    expect(orphansOf([...listing.branches, stale], now).map((b) => b.name)).toEqual(['new'])
  })
})
