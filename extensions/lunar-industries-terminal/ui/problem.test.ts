import { describe, expect, it } from 'vitest'
import { emulatorProblem } from './problem.ts'

describe('Terminal (Lunar Industries) · the emulator', () => {
  it('says plainly that the page refuses WebAssembly, and what to do meanwhile', () => {
    const refused = new Error(
      "WebAssembly.compile(): Compiling or instantiating WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script",
    )
    expect(emulatorProblem(refused)).toMatch(/interdit WebAssembly.*Terminal officiel dans Réglages › Rôles/)
  })

  it('passes on any other reason', () => {
    expect(emulatorProblem(new Error('out of memory'))).toBe('Le terminal ne se charge pas : out of memory')
  })
})
