import { describe, expect, it } from 'vitest'
import { dropIndex, moved } from './order.ts'

describe('Terminal (Lunar Industries) · the tabs dragged into another order', () => {
  it('moves a tab before the one it is dropped on, or last', () => {
    expect(moved(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['a', 'c', 'b', 'd'])
    expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moved(['a', 'b', 'c', 'd'], 0, 4)).toEqual(['b', 'c', 'd', 'a'])
    expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moved(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })

  it('drops after a tab past its middle', () => {
    expect(dropIndex(2, 125, 100, 60)).toBe(2)
    expect(dropIndex(2, 131, 100, 60)).toBe(3)
  })
})
