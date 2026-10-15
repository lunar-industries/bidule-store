import { describe, expect, it } from 'vitest'
import { mascot } from '../ui/mascot.ts'

describe('HAL', () => {
  it('speaks to Dave, at the end of its first sentence', () => {
    expect(mascot.speak('Coin ! Tout est à jour.', 'quack')).toBe('Bien. Tout est à jour, Dave.')
    expect(mascot.speak('3 tâches en cours. Laquelle on avance ?', 'listen')).toBe(
      '3 tâches en cours, Dave. Laquelle on avance ?',
    )
    expect(mascot.speak('Laquelle on avance ?', 'listen')).toBe('Laquelle on avance, Dave ?')
    expect(mascot.speak(mascot.hello, 'listen')).toBe(mascot.hello)
  })

  it('never raises its voice, and lets Dave sleep', () => {
    expect(mascot.speak('Coin ! Tout est à jour !', 'quack')).not.toContain('!')
    expect(mascot.speak('Je fais une petite sieste.', 'sleep')).toBe('Je fais une petite sieste.')
  })
})
