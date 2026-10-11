import { describe, expect, test } from 'vitest'
import { BranchesError } from '../server/errors.ts'
import { branch, branchId, fakeForge, fakeWorld, service, task } from './fakes.ts'

const app = '/r/app'
const all = () => [
  branch({ name: 'main', isDefault: true }),
  branch({ name: 'develop' }),
  branch({ name: '42-ecran-de-connexion', taskId: 't1' }),
  branch({ name: 'tsk-7-paiement' }),
]

describe('the listing', () => {
  test('without the default and integration branches, which are the repo’s targets; issues read from the names', async () => {
    const { world } = fakeWorld(all(), fakeForge().client)
    const { s } = service(world, { settings: { 'lunar-industries-branches.hidden': 'main, develop', 'lunar-industries-branches.reviewTarget': 'develop' } })
    const l = await s.list()
    expect(l.branches.map((b) => b.name)).toEqual(['42-ecran-de-connexion', 'tsk-7-paiement'])
    expect(l.branches[0]).toMatchObject({ forge: 'gitlab', issueNumber: 42 })
    expect(l.branches[1].issueNumber).toBeNull()
    expect(l.repos).toEqual([{ path: app, label: 'app', forge: 'gitlab', targets: ['main', 'develop'], reviewTarget: null }])
    expect(l.defaultTarget).toBe('develop')
  })

  test('a repo without a forge (or its token) lists its branches without one', async () => {
    const { world } = fakeWorld(all(), null)
    const l = await service(world).s.list()
    expect(l.branches.every((b) => b.forge === null)).toBe(true)
  })

  test('each branch with its task, its review and its CI, as the core has them; newest first', async () => {
    const old = new Date(Date.now() - 864e5).toISOString()
    const { world } = fakeWorld(
      [
        branch({ name: 'a', lastCommitAt: old, taskId: 't1', reviewNumber: 3, reviewState: 'open', ci: 'fail' }),
        branch({ name: 'b', reviewNumber: 4, reviewState: 'merged' }),
        branch({ name: 'c', lastCommitAt: null }),
      ],
      null
    )
    const l = await service(world).s.list()
    expect(l.branches.map((b) => [b.name, b.taskId, b.reviewNumber, b.reviewState, b.ci])).toEqual([
      ['b', null, 4, 'merged', 'merged'],
      ['a', 't1', 3, 'open', 'fail'],
      ['c', null, null, null, null],
    ])
  })
})

describe('on the forge', () => {
  test('a draft review towards the repo’s target, titled after the task, closing the issue', async () => {
    const forge = fakeForge()
    const { world, refreshed } = fakeWorld(all(), forge.client)
    const { s } = service(world, { tasks: [task('t1', 'Écran de connexion')] })
    await s.setTarget(app, 'develop')
    await s.review(app, '42-ecran-de-connexion', null)
    expect(forge.reviews).toEqual([
      {
        source: '42-ecran-de-connexion',
        target: 'develop',
        title: 'Écran de connexion',
        description: 'Closes #42\n\nTâche : https://notion.so/t1',
        draft: true,
      },
    ])
    // The forge reads the branch again: its review and its CI follow.
    expect(refreshed).toEqual([{ repositoryId: 'repo:/r/app', branchIds: ['/r/app\n42-ecran-de-connexion'] }])
  })

  test('a number in the name is no issue unless the forge has it: nothing is closed by mistake', async () => {
    const forge = fakeForge({ issue: async () => null })
    const { world } = fakeWorld([branch({ name: '2024-cleanup' })], forge.client)
    const { s } = service(world)
    await s.review(app, '2024-cleanup', 'main')
    expect(forge.reviews[0]?.description).toBe('')
  })

  test('the issue in a name is found whatever its case', async () => {
    const forge = fakeForge()
    const { world } = fakeWorld([branch({ name: '42-Ecran' })], forge.client)
    await service(world, { settings: { 'lunar-industries-branches.template': '{issue}-{slug}' } }).s.review(app, '42-Ecran', 'main')
    expect(forge.reviews[0]?.description).toBe('Closes #42')
  })

  test('without any target, the review is refused', async () => {
    const { world } = fakeWorld(all(), fakeForge().client)
    await expect(service(world).s.review(app, 'tsk-7-paiement', null)).rejects.toThrow(/cible/)
  })

  test('the latest pipeline relaunched, its manual jobs, one played', async () => {
    const forge = fakeForge()
    const { world } = fakeWorld(all(), forge.client)
    const { s } = service(world)
    await s.retry(app, 'tsk-7-paiement')
    expect((await s.jobs(app, 'tsk-7-paiement')).map((j) => j.id)).toEqual([7, 8])
    await s.play(app, 'tsk-7-paiement', 7)
    await s.runPipeline(app, 'tsk-7-paiement')
    expect(forge.calls).toEqual(['retry 99', 'jobs 99', 'play 7', 'run tsk-7-paiement'])
  })

  test('where the review, pipeline and issue are, read now', async () => {
    const { world } = fakeWorld(all(), fakeForge().client)
    expect(await service(world).s.links(app, '42-ecran-de-connexion')).toEqual({
      reviewUrl: 'https://gitlab.com/team/app/-/merge_requests/12',
      pipelineUrl: 'https://gitlab.com/team/app/-/pipelines/99',
      issueUrl: 'https://gitlab.com/team/app/-/issues/42',
    })
  })

  test('a forge’s refusal keeps its words; a server error is a 502', async () => {
    const denied = Object.assign(new Error('GitLab refuse : le jeton doit pouvoir écrire'), { status: 403 })
    const down = Object.assign(new Error('GitLab 503'), { status: 503 })
    const refusing = fakeWorld(all(), fakeForge({ runPipeline: async () => Promise.reject(denied) }).client)
    const failing = fakeWorld(all(), fakeForge({ runPipeline: async () => Promise.reject(down) }).client)
    const one = service(refusing.world).s.runPipeline(app, 'tsk-7-paiement')
    await expect(one).rejects.toMatchObject({ status: 422, message: denied.message })
    await expect(service(failing.world).s.runPipeline(app, 'tsk-7-paiement')).rejects.toMatchObject({ status: 502 })
  })

  test('no forge, an unknown branch or repo: said', async () => {
    const none = fakeWorld(all(), null)
    await expect(service(none.world).s.runPipeline(app, 'tsk-7-paiement')).rejects.toThrow(/pas de remote/)
    const err = await service(fakeWorld(all(), fakeForge().client).world)
      .s.links(app, 'nope')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BranchesError)
    expect(err).toMatchObject({ status: 404 })
    await expect(service(none.world).s.links('/elsewhere', 'main')).rejects.toMatchObject({ status: 404 })
  })
})

describe('the task and the target', () => {
  test('a branch linked by hand in the core: its other tasks and the opposite mark go, the rule on names does not undo it', async () => {
    const { world, relations } = fakeWorld(all(), null)
    const { s } = service(world, { tasks: [task('t1', 'Écran de connexion'), task('t7', 'Paiement', { ref: 'TSK-7' })] })
    const paiement = branchId({ repo: app, name: 'tsk-7-paiement' })
    const linksOf = () =>
      relations
        .filter((l) => l.to.id === paiement || l.from.id === paiement)
        .map((l) => [l.kind, l.from.id, l.origin])
    // Any change runs the core's rule, which links the branch to the task its name refers to.
    await s.link(app, '42-ecran-de-connexion', 't1')
    expect(linksOf()).toEqual([['branch', 't7', 'ref']])
    // To another task by hand: the task its name refers to does not come back.
    await s.link(app, 'tsk-7-paiement', 't1')
    expect(linksOf()).toEqual([['branch', 't1', 'manual']])
    // Unlinked by hand: marked so, and still not linked by its name.
    await s.link(app, 'tsk-7-paiement', null)
    expect(linksOf()).toEqual([['noTask', paiement, 'manual']])
    expect((await s.list()).branches.find((b) => b.name === 'tsk-7-paiement')?.taskId).toBeNull()
    // Linked again: the mark goes.
    await s.link(app, 'tsk-7-paiement', 't7')
    expect(linksOf()).toEqual([['branch', 't7', 'manual']])
    await expect(s.link(app, 'nope', 't1')).rejects.toMatchObject({ status: 404 })
    await expect(s.link('/elsewhere', 'tsk-7-paiement', 't1')).rejects.toMatchObject({ status: 404 })
  })

  test('a target kept per repo and announced', async () => {
    const { world } = fakeWorld(all(), null)
    const { s, saved, changed } = service(world)
    await s.setTarget(app, 'main')
    expect(JSON.parse(saved['lunar-industries-branches.targets'])).toEqual({ [app]: 'main' })
    await s.setTarget(app, null)
    expect(JSON.parse(saved['lunar-industries-branches.targets'])).toEqual({})
    expect(changed()).toBe(2)
    await expect(s.setTarget('/elsewhere', 'main')).rejects.toMatchObject({ status: 404 })
  })
})
