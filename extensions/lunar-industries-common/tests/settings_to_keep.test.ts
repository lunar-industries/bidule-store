import { describe, expect, test } from 'vitest'
import { OLD_INTEGRATION, settingsToKeep } from '../server/settings_to_keep.ts'

// The rows as the settings table keeps them: JSON.
const rows = (values: Record<string, unknown>) => new Map(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]))
const kept = (stored: Map<string, string>, used: boolean) =>
  Object.fromEntries([...settingsToKeep(stored, used)].map(([k, v]) => [k, JSON.parse(v)]))

describe('the settings the modules kept, taken over at install', () => {
  test('the integration branches: the union of the lists saved, each name once whatever its case', () => {
    const stored = rows({
      'lunar-industries-branches.hidden': 'main, develop, staging',
      'lunar-industries-kanban.hiddenBranches': 'Main, release',
      'lunar-industries-claude.integrationBranches': 'develop',
    })
    expect(kept(stored, true)).toEqual({ 'lunar-industries-common.integrationBranches': 'main, develop, staging, release' })
  })

  test('nothing saved, but the modules served: the old default they followed', () => {
    expect(kept(new Map(), true)).toEqual({ 'lunar-industries-common.integrationBranches': OLD_INTEGRATION })
  })

  test('a new install: nothing, the shared default applies', () => {
    expect(kept(new Map(), false)).toEqual({})
  })

  test('a shared setting already saved is left alone', () => {
    const stored = rows({
      'lunar-industries-branches.hidden': 'main, develop',
      'lunar-industries-common.integrationBranches': 'main',
      'lunar-industries-branches.reviewTarget': 'develop',
      'lunar-industries-common.reviewTarget': '',
    })
    expect(kept(stored, true)).toEqual({})
  })

  test('the review target, the naming and its template: the Branches page’s, else Claude’s', () => {
    const stored = rows({
      'lunar-industries-branches.reviewTarget': '',
      'lunar-industries-claude.reviewTarget': 'develop',
      'lunar-industries-branches.naming': 'ref',
      'lunar-industries-claude.branchNaming': 'template',
      'lunar-industries-claude.branchTemplate': 'feature/{ref}',
      'lunar-industries-claude.integrationBranches': 'main',
    })
    expect(kept(stored, true)).toEqual({
      'lunar-industries-common.integrationBranches': 'main',
      'lunar-industries-common.reviewTarget': 'develop',
      'lunar-industries-common.naming': 'ref',
      'lunar-industries-common.template': 'feature/{ref}',
    })
  })

  test('a naming that is not an option is ignored', () => {
    expect(kept(rows({ 'lunar-industries-branches.naming': 'other' }), false)).toEqual({})
  })

  test('each repo’s target: Claude’s per-repo settings, then the Branches page’s, which wins', () => {
    const stored = rows({
      'lunar-industries-claude.repos': JSON.stringify({ '/r/app': { reviewTarget: 'main', worktreePrepare: 'npm ci' }, '/r/api': { reviewTarget: 'develop' } }),
      'lunar-industries-branches.targets': JSON.stringify({ '/r/app': 'staging', '/r/web': '' }),
    })
    const out = kept(stored, false)
    expect(JSON.parse(out['lunar-industries-common.targets'])).toEqual({ '/r/app': 'staging', '/r/api': 'develop' })
  })

  test('values that cannot be read are skipped', () => {
    const stored = new Map([
      ['lunar-industries-claude.repos', 'not json'],
      ['lunar-industries-branches.targets', JSON.stringify('[1]')],
    ])
    expect(kept(stored, false)).toEqual({})
  })
})
