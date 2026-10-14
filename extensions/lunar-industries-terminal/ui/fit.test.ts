import { describe, expect, it } from 'vitest'
import { bannerCap, roomBeside, tabsFit } from './fit.ts'

describe('Terminal (Lunar Industries) · the terminal tabs, side by side or in a list', () => {
  it('keeps the row while the tabs, their gaps and the padding fit', () => {
    expect(tabsFit([100, 120, 80], 312, 4, 4)).toBe(true)
    expect(tabsFit([100, 120, 80], 311, 4, 4)).toBe(false)
    expect(tabsFit([100, 120, 80], 311.6, 4, 4)).toBe(true)
  })

  it('keeps the row without tabs', () => {
    expect(tabsFit([], 0)).toBe(true)
  })

  it('measures the room the other controls leave', () => {
    expect(roomBeside(600, [32, 140], 8)).toBe(412)
    expect(roomBeside(100, [80, 60], 8)).toBe(0)
  })

  it('caps the strip on the banner by the window', () => {
    expect(bannerCap(2000)).toBe(760)
    expect(bannerCap(1000)).toBe(600)
  })
})
