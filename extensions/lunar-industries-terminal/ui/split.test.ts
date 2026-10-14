import { describe, expect, it } from 'vitest'
import { clampRatio, MAX_RATIO, MIN_RATIO, otherPane, ratioAt, ratioByKey, splitAction } from './split.ts'

const keys = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  ...mods,
})

describe('Terminal (Lunar Industries) · a split tab', () => {
  it('keeps both panes visible however far the boundary is dragged', () => {
    expect(clampRatio(0)).toBe(MIN_RATIO)
    expect(clampRatio(1)).toBe(MAX_RATIO)
    expect(clampRatio(Number.NaN)).toBe(0.5)
    expect(ratioAt(300, 100, 400)).toBe(0.5)
    expect(ratioAt(90, 100, 400)).toBe(MIN_RATIO)
    expect(ratioAt(50, 0, 0)).toBe(0.5)
  })

  it('moves the boundary with the arrows of its axis only, and Home / End to the ends', () => {
    expect(ratioByKey(0.5, 'ArrowRight', 'row')).toBeCloseTo(0.55)
    expect(ratioByKey(0.5, 'ArrowLeft', 'row')).toBeCloseTo(0.45)
    expect(ratioByKey(0.5, 'ArrowDown', 'row')).toBeNull()
    expect(ratioByKey(0.5, 'ArrowDown', 'column')).toBeCloseTo(0.55)
    expect(ratioByKey(0.84, 'ArrowRight', 'row')).toBe(MAX_RATIO)
    expect(ratioByKey(0.5, 'Home', 'column')).toBe(MIN_RATIO)
    expect(ratioByKey(0.5, 'End', 'row')).toBe(MAX_RATIO)
  })

  it('goes from one pane to the other, and stays on the only one', () => {
    expect(otherPane(0, 2)).toBe(1)
    expect(otherPane(1, 2)).toBe(0)
    expect(otherPane(0, 1)).toBe(0)
  })

  it('reads its keys: Ctrl+Shift+E side by side, Ctrl+Shift+O stacked, Ctrl+Shift+arrow to the other pane', () => {
    expect(splitAction(keys('E'))).toBe('split-row')
    expect(splitAction(keys('o'))).toBe('split-column')
    expect(splitAction(keys('ArrowUp'))).toBe('other-pane')
    expect(splitAction(keys('e', { shiftKey: false }))).toBeNull()
    expect(splitAction(keys('e', { altKey: true }))).toBeNull()
    expect(splitAction(keys('t'))).toBeNull()
  })
})
