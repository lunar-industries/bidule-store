import type { ServerContext } from '@bidule/api/extensions'
import { describe, expect, it } from 'vitest'
import { readSettings, reviewTargetOf, templateOf } from '../server/settings.ts'

// The module's settings, with the suite's shared ones read from the Branches module's keys.
const contextWith = (values: Record<string, unknown>) =>
  ({ settings: { get: async (key: string) => values[key] } }) as unknown as ServerContext

describe('Claude settings · what the suite shares', () => {
  it('reads the integration branches, naming, issue and review targets from the Branches module', async () => {
    const s = await readSettings(
      contextWith({
        'lunar-industries-branches.hidden': 'main, develop',
        'lunar-industries-branches.naming': 'template',
        'lunar-industries-branches.template': '{ref}/{slug}',
        'lunar-industries-branches.createIssue': '1',
        'lunar-industries-branches.reviewTarget': 'launchpad',
        'lunar-industries-branches.targets': '{"/r/app":"develop"}',
      })
    )
    expect(s.integrationBranches).toEqual(['main', 'develop'])
    expect(templateOf(s)).toBe('{ref}/{slug}')
    expect(s.createIssue).toBe(true)
    // A repo's own target comes before the suite's.
    expect(reviewTargetOf(s, '/r/app')).toBe('develop')
    expect(reviewTargetOf(s, '/r/other')).toBe('launchpad')
  })

  it('without the Branches module, the defaults', async () => {
    const s = await readSettings(contextWith({}))
    expect(s.integrationBranches).toEqual(['main', 'master', 'develop', 'launchpad', 'factory', 'orbit'])
    expect(s.createIssue).toBe(false)
    expect(templateOf(s)).toBe('{issue}-{slug}')
    expect(reviewTargetOf(s, '/r/app')).toBeNull()
  })

  it('a damaged list of targets leaves every repo on the suite’s', async () => {
    const s = await readSettings(contextWith({ 'lunar-industries-branches.targets': '{oups', 'lunar-industries-branches.reviewTarget': 'main' }))
    expect(reviewTargetOf(s, '/r/app')).toBe('main')
  })
})
