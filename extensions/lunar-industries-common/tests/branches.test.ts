import { describe, expect, test } from 'vitest'
import { linkByHand, setTasksByHand, sharedBranches } from '../server/branches.ts'
import { branch, fakeCore, linked, pipeline, review, task } from './fakes.ts'

const NONE = new Set<string>()

describe('the branches as the core has them', () => {
  test('without a provider of branches, none, and said', async () => {
    const { objects } = fakeCore({ branches: [branch('a', 'a')], providers: ['repository', 'task'] })
    expect(await sharedBranches(objects, NONE, {})).toEqual({ available: false, branches: [] })
  })

  test('each with its repo, newest first', async () => {
    const { objects } = fakeCore({
      branches: [
        branch('a', 'feat/a', { lastCommitAt: '2026-10-01T08:00:00Z' }),
        branch('b', 'feat/b', { repositoryId: 'r2', lastCommitAt: '2026-10-02T08:00:00Z' }),
        branch('c', 'feat/c'),
      ],
    })
    const { available, branches } = await sharedBranches(objects, NONE, {})
    expect(available).toBe(true)
    expect(branches.map((b) => [b.name, b.repo, b.repoLabel, b.repositoryId])).toEqual([
      ['feat/b', '/r/api', 'api', 'r2'],
      ['feat/a', '/r/app', 'app', 'r1'],
      ['feat/c', '/r/app', 'app', 'r1'],
    ])
  })

  test('a branch’s task is the one linked by hand first, else the one the rule linked', async () => {
    const { objects } = fakeCore({
      branches: [branch('a', 'a'), branch('b', 'b'), branch('c', 'c')],
      links: [linked('x', 'a', 'ref'), linked('t', 'a', 'manual'), linked('x', 'b', 'ref')],
    })
    const { branches } = await sharedBranches(objects, NONE, {})
    expect(branches.map((b) => [b.name, b.taskId, b.taskIds])).toEqual([
      ['a', 't', ['t', 'x']],
      ['b', 'x', ['x']],
      ['c', null, []],
    ])
  })

  test('its latest review, its CI: merged once the review is, none for a review without pipeline, null without both', async () => {
    const { objects } = fakeCore({
      branches: [branch('open', 'open'), branch('merged', 'merged'), branch('ci', 'ci'), branch('bare', 'bare')],
      reviews: [review('v1', 'open', 3, 'open'), review('v2', 'open', 7, 'open', 'https://r/7'), review('v3', 'merged', 4, 'merged')],
      pipelines: [pipeline('p1', 'ci', 'fail', 'https://p/1'), pipeline('p2', 'merged', 'ok')],
    })
    const { branches } = await sharedBranches(objects, NONE, {})
    expect(branches.map((b) => [b.name, b.reviewRef, b.reviewNumber, b.reviewState, b.ci, b.url])).toEqual([
      ['open', 'MR !7', 7, 'open', 'none', 'https://r/7'],
      ['merged', 'MR !4', 4, 'merged', 'merged', null],
      ['ci', null, null, null, 'fail', 'https://p/1'],
      ['bare', null, null, null, null, null],
    ])
  })

  test('the integration branches are marked whatever their case; the default one says so on its own', async () => {
    const { objects } = fakeCore({ branches: [branch('m', 'main', { isDefault: true }), branch('d', 'Develop'), branch('f', 'feat/a')] })
    const { branches } = await sharedBranches(objects, new Set(['develop']), {})
    expect(branches.map((b) => [b.name, b.isDefault, b.integration])).toEqual([
      ['main', true, false],
      ['Develop', false, true],
      ['feat/a', false, false],
    ])
  })

  test('a task’s branches only, or one repo’s, or one branch', async () => {
    const { objects } = fakeCore({
      branches: [branch('a', 'feat/a'), branch('b', 'feat/b', { repositoryId: 'r2' }), branch('c', 'feat/c')],
      links: [linked('t', 'a'), linked('t', 'b', 'ref'), linked('x', 'c')],
    })
    const names = async (filter: Parameters<typeof sharedBranches>[2]) =>
      (await sharedBranches(objects, NONE, filter)).branches.map((b) => b.name).sort()
    expect(await names({ taskId: 't' })).toEqual(['feat/a', 'feat/b'])
    expect(await names({ taskId: 'nobody' })).toEqual([])
    expect(await names({ repo: '/r/app' })).toEqual(['feat/a', 'feat/c'])
    expect(await names({ repo: '/r/app', name: 'feat/c' })).toEqual(['feat/c'])
    expect(await names({ repo: '/elsewhere' })).toEqual([])
  })
})

describe('a link by hand', () => {
  test('to a task: the link by hand first, then the other tasks and the mark go; the rule does not link it back', async () => {
    const { objects, calls, linksOf } = fakeCore({
      branches: [branch('b', 'id-7-paiement')],
      tasks: [task('t7', 'id-7'), task('t1'), task('x')],
      links: [linked('t7', 'b', 'ref'), linked('x', 'b', 'manual')],
    })
    expect(await linkByHand(objects, '/r/app', 'id-7-paiement', 't1')).toBe(true)
    // The core took the link by name away itself; the other link by hand goes.
    expect(calls).toEqual(['link branch t1 b', 'unlink branch x b', 'unlink noTask b b'])
    expect(linksOf('b')).toEqual([['branch', 't1', 'manual']])
  })

  test('to none: marked so, its tasks go, and its name links it to nothing', async () => {
    const { objects, linksOf } = fakeCore({
      branches: [branch('b', 'id-7-paiement')],
      tasks: [task('t7', 'id-7')],
      links: [linked('t7', 'b', 'ref')],
    })
    expect(await linkByHand(objects, '/r/app', 'id-7-paiement', null)).toBe(true)
    expect(linksOf('b')).toEqual([['noTask', 'b', 'manual']])
    expect(await linkByHand(objects, '/r/app', 'id-7-paiement', 't7')).toBe(true)
    expect(linksOf('b')).toEqual([['branch', 't7', 'manual']])
  })

  test('an unknown branch, repo or task changes nothing', async () => {
    const { objects, calls } = fakeCore({ branches: [branch('b', 'feat/b')] })
    expect(await linkByHand(objects, '/r/app', 'nope', 't')).toBe(false)
    expect(await linkByHand(objects, '/elsewhere', 'feat/b', 't')).toBe(false)
    expect(await linkByHand(objects, '/r/app', 'feat/b', 'gone')).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('a branch’s tasks, set by hand', () => {
  test('several: each linked by hand, the one the rule linked kept that way, the others go', async () => {
    const { objects, linksOf } = fakeCore({
      branches: [branch('b', 'id-7-paiement')],
      tasks: [task('t7', 'id-7'), task('t1'), task('x')],
      links: [linked('t7', 'b', 'ref'), linked('x', 'b', 'manual')],
    })
    expect(await setTasksByHand(objects, '/r/app', 'id-7-paiement', ['t7', 't1', 't1'])).toBe(true)
    expect(linksOf('b').sort()).toEqual([
      ['branch', 't1', 'manual'],
      ['branch', 't7', 'manual'],
    ])
  })

  test('none: marked so; then one again, and the mark goes', async () => {
    const { objects, linksOf } = fakeCore({
      branches: [branch('b', 'feat/b')],
      tasks: [task('t1'), task('t2')],
      links: [linked('t1', 'b', 'manual'), linked('t2', 'b', 'manual')],
    })
    expect(await setTasksByHand(objects, '/r/app', 'feat/b', [])).toBe(true)
    expect(linksOf('b')).toEqual([['noTask', 'b', 'manual']])
    expect(await setTasksByHand(objects, '/r/app', 'feat/b', ['t2'])).toBe(true)
    expect(linksOf('b')).toEqual([['branch', 't2', 'manual']])
  })

  test('one unknown task among them changes nothing', async () => {
    const { objects, calls } = fakeCore({ branches: [branch('b', 'feat/b')], tasks: [task('t1')] })
    expect(await setTasksByHand(objects, '/r/app', 'feat/b', ['t1', 'gone'])).toBe(false)
    expect(calls).toEqual([])
  })
})
