import { describe, expect, test } from 'vitest'
import { latestOf } from '../ui/latest.ts'

// Lets the promises already settled run their callbacks.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('latestOf', () => {
  test('keeps only the answer to the last ask, even when an older one comes after it', async () => {
    const answers: ((value: string) => void)[] = []
    const read = latestOf(() => new Promise<string>((resolve) => answers.push(resolve)))
    const got: string[] = []
    void read().then((v) => got.push(v))
    void read().then((v) => got.push(v))
    answers[1]('récente')
    await settle()
    answers[0]('ancienne')
    await settle()
    expect(got).toEqual(['récente'])
  })

  test('gives the error of the last ask, and drops an older one', async () => {
    const answers: ((error: Error) => void)[] = []
    const read = latestOf(() => new Promise<string>((_, reject) => answers.push(reject)))
    const failed: string[] = []
    void read().catch((e: Error) => failed.push(e.message))
    void read().catch((e: Error) => failed.push(e.message))
    answers[0](new Error('ancienne'))
    answers[1](new Error('récente'))
    await settle()
    expect(failed).toEqual(['récente'])
  })
})
