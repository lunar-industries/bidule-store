import { describe, expect, it } from 'vitest'
import { mascot } from '../ui/mascot.ts'

describe('Gerty', () => {
  it('never exclaims', () => {
    expect(mascot.speak('Coin ! Tout est à jour !', 'listen')).not.toContain('!')
  })

  it('smiles after good news, once', () => {
    expect(mascot.speak('Coin ! Tout est à jour.', 'quack')).toBe('Pling. Tout est à jour. :)')
    expect(mascot.speak(mascot.hello, 'quack')).toBe(mascot.hello)
    expect(mascot.speak('La CI est rouge.', 'panic')).toBe('Pling. La CI est rouge.')
  })
})
