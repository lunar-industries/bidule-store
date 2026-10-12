import { describe, expect, test } from 'vitest'
import { readShared, targetsOf, withTarget } from '../server/settings.ts'

const reader = (saved: Record<string, unknown>) => async (key: string) => saved[key]

describe('the shared settings', () => {
  test('as the modules get them: lists without the empty names, the naming’s template', async () => {
    const shared = await readShared(
      reader({
        'lunar-industries-common.integrationBranches': ' main, Develop ,, staging',
        'lunar-industries-common.reviewTarget': ' develop ',
        'lunar-industries-common.naming': 'ref',
        'lunar-industries-common.template': '{issue}-{slug}',
        'lunar-industries-common.targets': '{"/r/app":"main"}',
      })
    )
    expect(shared).toEqual({
      integrationBranches: ['main', 'Develop', 'staging'],
      reviewTarget: 'develop',
      targets: { '/r/app': 'main' },
      naming: 'ref',
      template: '{ref}-{slug}',
    })
  })

  test('the free template with « Modèle libre », and nothing said gives no target', async () => {
    const shared = await readShared(
      reader({ 'lunar-industries-common.naming': 'template', 'lunar-industries-common.template': 'feature/{ref}' })
    )
    expect(shared).toMatchObject({ reviewTarget: null, targets: {}, naming: 'template', template: 'feature/{ref}' })
  })

  test('the repos’ targets: what cannot be read is none, a target set or taken back', () => {
    expect(targetsOf('not json')).toEqual({})
    expect(targetsOf('["main"]')).toEqual({})
    expect(targetsOf('{"/r/a":"main","/r/b":"","/r/c":3}')).toEqual({ '/r/a': 'main' })
    expect(JSON.parse(withTarget({ '/r/a': 'main' }, '/r/b', ' develop '))).toEqual({ '/r/a': 'main', '/r/b': 'develop' })
    expect(JSON.parse(withTarget({ '/r/a': 'main' }, '/r/a', null))).toEqual({})
  })
})
