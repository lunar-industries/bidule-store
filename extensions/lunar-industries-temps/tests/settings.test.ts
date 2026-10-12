import { describe, expect, test } from 'vitest'
import { deployBranchesToKeep } from '../server/settings.ts'

// The values as the settings table keeps them: JSON.
describe('the old production branches, kept for an install that used them', () => {
  test('a module that served without the setting saved keeps the old default', () => {
    expect(deployBranchesToKeep(undefined, true)).toBe('"launchpad, orbit"')
  })

  test('a value saved by the user is left alone, even an empty one', () => {
    expect(deployBranchesToKeep('"prod"', true)).toBeNull()
    expect(deployBranchesToKeep('""', true)).toBeNull()
  })

  test('a new install gets nothing: no production branch', () => {
    expect(deployBranchesToKeep(undefined, false)).toBeNull()
  })
})
