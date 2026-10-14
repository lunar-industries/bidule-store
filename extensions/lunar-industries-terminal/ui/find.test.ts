import { describe, expect, it } from 'vitest'
import { findMatches, pickMatch, viewFor } from './find.ts'

describe('Terminal (Lunar Industries) · search', () => {
  const lines = ['npm test', 'Error: boom', '', 'error again, ERROR twice']

  it('finds every match in reading order, ignoring case unless asked', () => {
    expect(findMatches(lines, 'error', false)).toEqual([
      { row: 1, start: 0, end: 5 },
      { row: 3, start: 0, end: 5 },
      { row: 3, start: 13, end: 18 },
    ])
    expect(findMatches(lines, 'ERROR', true)).toEqual([{ row: 3, start: 13, end: 18 }])
    expect(findMatches(lines, '', false)).toEqual([])
  })

  it('finds overlapping matches', () => {
    expect(findMatches(['aaa'], 'aa', true).map((m) => m.start)).toEqual([0, 1])
  })

  it('picks the next match, the previous one, round the ends', () => {
    const found = findMatches(lines, 'error', false)
    expect(pickMatch(found, { row: 1, start: 0 })).toBe(1)
    expect(pickMatch(found, { row: 3, start: 13 })).toBe(0)
    expect(pickMatch(found, { row: 3, start: 0 }, { backwards: true })).toBe(0)
    expect(pickMatch(found, { row: 1, start: 0 }, { backwards: true })).toBe(2)
    expect(pickMatch([], { row: 0, start: 0 })).toBe(-1)
  })

  it('stays on the match the typing grew, and starts from the view without one', () => {
    const found = findMatches(lines, 'erro', false)
    expect(pickMatch(found, { row: 3, start: 0 }, { stay: true })).toBe(1)
    expect(pickMatch(found, { row: 2, start: -1 })).toBe(1)
  })

  it('scrolls only when the row is out of sight, putting it a third of the way down', () => {
    // 100 lines of scrollback, 30 rows on screen, at the bottom: rows 100 to 129 are in sight.
    expect(viewFor(110, 0, 100, 30)).toBe(0)
    expect(viewFor(40, 0, 100, 30)).toBe(70)
    expect(viewFor(0, 0, 100, 30)).toBe(100)
  })
})
