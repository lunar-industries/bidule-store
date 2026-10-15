import { describe, expect, it } from 'vitest'
import type { Mood } from '@bidule/sdk'
import { mascot } from '../ui/mascot.ts'

// What Bidule checks for each mascot of its own repository (core/web/src/mascots.test.ts), which never sees this
// store's modules.
const MOODS: Mood[] = ['calm', 'happy', 'angry', 'sleep', 'sad']

describe(`${mascot.name}'s drawings`, () => {
  it('has five moods that differ, its decor and its head, with no number lost', async () => {
    const art = await mascot.art()
    for (const mood of MOODS) expect(art.moods[mood]).toContain('<svg')
    expect(new Set(MOODS.map((mood) => art.moods[mood])).size).toBe(5)
    expect(art.decor).toContain('<svg')
    expect(art.head).toContain('<svg')
    for (const drawing of [...Object.values(art.moods), art.decor, art.head]) expect(drawing).not.toMatch(/NaN/)
  })

  it('says every line in its own voice', () => {
    const line = '3 tâches en cours. Laquelle on avance ?'
    expect(mascot.speak(line, 'listen')).not.toBe(line)
  })
})
