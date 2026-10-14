import { describe, expect, it } from 'vitest'
import { findFileLines, findReviews, findTaskRefs, findUrls } from './links.ts'

describe('Terminal (Lunar Industries) · what a terminal line can open', () => {
  const known = new Map([['ID-123', 'ID-123'], ['TSK-7', 'TSK-7']])

  it('links a task reference only when the board has it, in any case', () => {
    expect(findTaskRefs('fix(ID-123): done, see tsk-7 and ID-999', known)).toEqual([
      { start: 4, end: 10, text: 'ID-123', ref: 'ID-123' },
      { start: 23, end: 28, text: 'tsk-7', ref: 'TSK-7' },
    ])
    expect(findTaskRefs('2026-10-01 v0.1-3', known)).toEqual([])
  })

  it('finds a file and its line (and column), where compilers and test runners print them', () => {
    expect(findFileLines('  at src/app.ts:42:7 and (core/web/main.tsx:3)')).toEqual([
      { start: 5, end: 20, text: 'src/app.ts:42:7', path: 'src/app.ts', line: 42, column: 7 },
      { start: 26, end: 45, text: 'core/web/main.tsx:3', path: 'core/web/main.tsx', line: 3, column: null },
    ])
    expect(findFileLines('C:\\repo\\a.ts:1 and ~/x/y.md:12')).toEqual([
      { start: 0, end: 14, text: 'C:\\repo\\a.ts:1', path: 'C:\\repo\\a.ts', line: 1, column: null },
      { start: 19, end: 30, text: '~/x/y.md:12', path: '~/x/y.md', line: 12, column: null },
    ])
    expect(findFileLines('http://localhost:5173 and 12:30')).toEqual([])
  })

  it('finds a web address, without the punctuation or the bracket around it', () => {
    expect(findUrls('see https://example.org/a?b=1. (http://localhost:5173/x) [https://w.org/wiki/A_(b)]')).toEqual([
      { start: 4, end: 29, text: 'https://example.org/a?b=1' },
      { start: 32, end: 55, text: 'http://localhost:5173/x' },
      { start: 58, end: 82, text: 'https://w.org/wiki/A_(b)' },
    ])
    expect(findUrls('ftp://x.org and https:/broken')).toEqual([])
  })

  it('finds a review alone, not a colour, an anchor or a word', () => {
    expect(findReviews('Merged !45 (closes #12)')).toEqual([
      { start: 7, end: 10, text: '!45', kind: 'mr', number: 45 },
      { start: 19, end: 22, text: '#12', kind: 'pr', number: 12 },
    ])
    expect(findReviews('color #fff page#2 a!4')).toEqual([])
  })
})
