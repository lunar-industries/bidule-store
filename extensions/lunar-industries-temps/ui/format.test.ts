import { describe, expect, test } from 'vitest'
import { dayCalled, fmtShare, hm, kindLabel, monthStep, previousWorkDay, shift, weekNumber, workText } from './format.ts'

describe('Temps (Lunar Industries): formats', () => {
  test('a share reads in days', () => {
    expect([0, 1, 7, 20].map(fmtShare)).toEqual(['0', '0,05', '0,35', '1'])
    expect(hm(545)).toBe('09:05')
  })

  test('the work days read as a range when they follow each other', () => {
    expect(workText([1, 2, 3, 4, 5])).toBe('lun. – ven.')
    expect(workText([1, 3, 5])).toBe('lun., mer., ven.')
    expect(workText([])).toBe('aucun')
    expect(weekNumber(new Date(2026, 8, 21))).toBe(39)
  })

  test('a border trades twentieths between its neighbours, each keeping one', () => {
    expect(shift([10, 10], 0, 1, 3)).toEqual([13, 7])
    expect(shift([10, 10], 0, 1, 15)).toEqual([19, 1])
    expect(shift([10, 10], 0, 1, 0)).toBeNull()
    // The last border trades with what is not given out yet, never past the day.
    expect(shift([8, 6], 1, null, 4)).toEqual([8, 10])
    expect(shift([8, 6], 1, null, 9)).toEqual([8, 12])
    expect(shift([8, 6], 1, null, -9)).toEqual([8, 1])
  })

  test('the calendar leaves its month by year and month together', () => {
    const january = { y: 2027, m: 0 }
    // The day before 1 January is in December of the year before: the month before, not February.
    expect(monthStep(january, new Date(2026, 11, 31))).toBe(-1)
    expect(monthStep(january, new Date(2027, 0, 31))).toBe(0)
    expect(monthStep(january, new Date(2027, 1, 1))).toBe(1)
    expect(monthStep({ y: 2026, m: 11 }, new Date(2027, 0, 1))).toBe(1)
  })

  test('the day opened by itself is called yesterday, or by its name', () => {
    // Monday 19 October 2026: the work day before is Friday 16.
    expect(previousWorkDay('2026-10-19', [1, 2, 3, 4, 5])).toBe('2026-10-16')
    expect(previousWorkDay('2026-10-16', [1, 2, 3, 4, 5])).toBe('2026-10-15')
    expect(previousWorkDay('2026-10-16', [])).toBeNull()
    expect(dayCalled('2026-10-15', '2026-10-16')).toBe('Hier')
    expect(dayCalled('2026-10-16', '2026-10-19')).toBe('Vendredi 16 octobre')
  })

  test('the signals read in French', () => {
    expect(['commit', 'checkout', 'edit', 'task', 'status'].map(kindLabel)).toEqual([
      'commit',
      'changement de branche',
      'fichier modifié',
      'tâche modifiée',
      'statut changé',
    ])
  })
})
