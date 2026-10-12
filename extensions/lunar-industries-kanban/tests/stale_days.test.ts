import { describe, expect, test } from 'vitest'
import { staleDaysToKeep } from '../server/stale_days.ts'

// The values as the settings table keeps them: JSON.
describe('the official Kanban’s delay, taken over at install', () => {
  test('a value set in the official Kanban is kept', () => {
    expect(staleDaysToKeep('"10"', undefined)).toBe('"10"')
  })

  test('a value already set in the module is not overwritten', () => {
    expect(staleDaysToKeep('"10"', '"3"')).toBeNull()
  })

  test('nothing set in the official Kanban: nothing to keep (the default applies)', () => {
    expect(staleDaysToKeep(undefined, undefined)).toBeNull()
  })

  test('a value outside the options, or not JSON, is ignored', () => {
    expect(staleDaysToKeep('"6"', undefined)).toBeNull()
    expect(staleDaysToKeep('10', undefined)).toBeNull()
    expect(staleDaysToKeep('not json', undefined)).toBeNull()
  })
})
