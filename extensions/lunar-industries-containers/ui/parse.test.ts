import { describe, expect, it } from 'vitest'
import { followLogs, NO_LOGS, parseLine } from './format.ts'

// What the page makes of a container's logs (what the engines print, read, is the `docker` extension's and tested there).
describe('Lunar Industries - Conteneurs · logs', () => {
  it('reads a log line: its time, its text, its level', () => {
    const l = parseLine('2026-10-01T07:12:03.114000000Z ERROR boom')
    expect(l).toMatchObject({ stamp: '2026-10-01T07:12:03.114000000Z', text: 'ERROR boom', level: 'error' })
    expect(parseLine('sans heure')).toMatchObject({ stamp: '', time: '', text: 'sans heure', level: null })
  })

  it('follows the logs: only what is new, the last line again once, a line sharing the last time kept', () => {
    const read = (...raw: string[]) => raw.map(parseLine)
    const first = followLogs(read('2026-10-01T07:00:00Z a', '2026-10-01T07:00:01Z b'), NO_LOGS)
    expect(first.fresh.map((l) => l.text)).toEqual(['a', 'b'])
    // The engine gives the lines from the last time on: `b` again, and `c` written at the same second.
    const second = followLogs(read('2026-10-01T07:00:01Z b', '2026-10-01T07:00:01Z c'), first.cursor)
    expect(second.fresh.map((l) => l.text)).toEqual(['c'])
    const third = followLogs(read('2026-10-01T07:00:01Z b', '2026-10-01T07:00:01Z c', '2026-10-01T09:00:02+02:00 d'), second.cursor)
    expect(third.fresh.map((l) => l.text)).toEqual(['d'])
    expect(third.cursor.stamp).toBe('2026-10-01T09:00:02+02:00')
  })
})
