import { describe, expect, it } from 'vitest'
import { KEPT_MAX, keptKey, keptValues, rememberValues, type KeptValues } from './kept.ts'

describe('Terminal (Lunar Industries) · Dernières valeurs des scripts', () => {
  it('reads back only objects of values: texts, booleans, lists of texts', () => {
    expect(keptValues('pas un objet')).toBeNull()
    expect(keptValues([])).toBeNull()
    expect(keptValues(null)).toBeNull()
    expect(
      keptValues({
        [keptKey('/repo', 'up')]: { projects: ['api', 'web'], detach: true, extra: '--build', bad: 3, list: ['a', 1] },
        [keptKey('/repo', 'logs')]: 'pas des valeurs',
      }),
    ).toEqual({ [keptKey('/repo', 'up')]: { projects: ['api', 'web'], detach: true, extra: '--build' } })
  })

  it('puts the script last, in place of its former values', () => {
    const all: KeptValues = { [keptKey('/a', 'up')]: { x: '1' }, [keptKey('/a', 'logs')]: { y: true } }
    const next = rememberValues(all, '/a', 'up', { x: '2' })
    expect(Object.keys(next)).toEqual([keptKey('/a', 'logs'), keptKey('/a', 'up')])
    expect(next[keptKey('/a', 'up')]).toEqual({ x: '2' })
    // The same script in another repo is another entry.
    expect(Object.keys(rememberValues(all, '/b', 'up', {}))).toHaveLength(3)
  })

  it(`keeps ${KEPT_MAX} scripts at most, the oldest dropped`, () => {
    let all: KeptValues = {}
    for (let i = 0; i < KEPT_MAX + 5; i++) all = rememberValues(all, '/repo', `s${i}`, { n: String(i) })
    const keys = Object.keys(all)
    expect(keys).toHaveLength(KEPT_MAX)
    expect(keys[0]).toBe(keptKey('/repo', 's5'))
    expect(keys.at(-1)).toBe(keptKey('/repo', `s${KEPT_MAX + 4}`))
  })
})
