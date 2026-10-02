import type { ServerContext } from '@bidule/api/extensions'
import { describe, expect, it } from 'vitest'
import { readSettings, reviewTargetOf, templateOf } from '../server/settings.ts'

// The module's settings, with the suite's shared ones asked of the Branches module by its command (an extension cannot
// read another's settings: the core refuses a key its own bidule.json does not declare).
function contextWith(shared: unknown, own: Record<string, unknown> = {}) {
  return {
    settings: {
      get: async (key: string) => {
        if (!key.startsWith('lunar-industries-claude.')) throw new Error(`${key} non déclaré dans bidule.json`)
        return own[key]
      },
    },
    commands: {
      execute: async (command: string) => {
        if (command !== 'lunar-industries-branches.shared') throw new Error(`Commande inconnue : ${command}`)
        if (shared instanceof Error) throw shared
        return shared
      },
    },
  } as unknown as ServerContext
}

describe('Claude settings · what the suite shares', () => {
  it('takes the integration branches, naming, issue and review targets from the Branches module', async () => {
    const s = await readSettings(
      contextWith({
        integration: ['main', 'develop'],
        reviewTarget: 'launchpad',
        targets: { '/r/app': 'develop' },
        naming: 'template',
        template: '{ref}/{slug}',
        createIssue: true,
      })
    )
    expect(s.integrationBranches).toEqual(['main', 'develop'])
    expect(templateOf(s)).toBe('{ref}/{slug}')
    expect(s.createIssue).toBe(true)
    // A repo's own target comes before the suite's.
    expect(reviewTargetOf(s, '/r/app')).toBe('develop')
    expect(reviewTargetOf(s, '/r/other')).toBe('launchpad')
  })

  it('without the Branches module, the defaults, and the module’s own settings still read', async () => {
    const s = await readSettings(contextWith(new Error('Commande inconnue'), { 'lunar-industries-claude.root': '/work' }))
    expect(s.root).toBe('/work')
    expect(s.integrationBranches).toEqual(['main', 'master', 'develop', 'launchpad', 'factory', 'orbit'])
    expect(s.createIssue).toBe(false)
    expect(templateOf(s)).toBe('{issue}-{slug}')
    expect(reviewTargetOf(s, '/r/app')).toBeNull()
  })
})
