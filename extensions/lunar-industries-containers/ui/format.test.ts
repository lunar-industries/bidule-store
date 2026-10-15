import { describe, expect, it } from 'vitest'
import type { ContainerRow } from '../contract.ts'
import {
  chartPoints,
  chartTop,
  followLogs,
  healthOf,
  highlight,
  isActive,
  isFailed,
  logsText,
  NO_LOGS,
  parseLine,
  portsOf,
  portUrl,
  stateOf,
  tickKeyOf,
} from './format.ts'

const row = (patch: Partial<ContainerRow>): ContainerRow => ({
  engine: 'docker',
  id: 'a1b2c3',
  name: 'shop-web-1',
  image: 'shop-web:dev',
  state: 'running',
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  project: 'shop',
  service: 'web',
  ports: [],
  ...patch,
})

// What the list and a container's view make of the containers (what the engines print, read, is the `docker`
// extension's and tested there).
describe('Conteneurs (Lunar Industries) · the list', () => {
  it('keeps a tick under the project and the service, which outlive the container; else under its name', () => {
    expect(tickKeyOf(row({ id: 'old' }))).toBe('docker:shop/web')
    expect(tickKeyOf(row({ id: 'new' }))).toBe('docker:shop/web')
    expect(tickKeyOf(row({ project: null, service: null, name: 'mailpit', engine: 'podman' }))).toBe('podman:mailpit')
  })

  it('tells a failure from a stop: a code the user’s stop gives is no failure', () => {
    for (const code of [0, 130, 137, 143]) expect(isFailed(row({ state: 'exited', exitCode: code }))).toBe(false)
    expect(isFailed(row({ state: 'exited', exitCode: 1 }))).toBe(true)
    expect(isFailed(row({ state: 'dead' }))).toBe(true)
    expect(stateOf(row({ state: 'exited', exitCode: 1 }))).toEqual({ label: 'en échec (code 1)', tone: 'bad' })
    expect(stateOf(row({ state: 'exited', exitCode: 0 }))).toEqual({ label: 'arrêté', tone: 'off' })
  })

  it('keeps in « Actifs » what runs and what needs a look', () => {
    expect(['running', 'restarting', 'paused'].every((state) => isActive(row({ state: state as ContainerRow['state'] })))).toBe(true)
    expect(isActive(row({ state: 'exited', exitCode: 2 }))).toBe(true)
    expect(isActive(row({ state: 'exited', exitCode: 0 }))).toBe(false)
    expect(isActive(row({ state: 'created' }))).toBe(false)
  })

  it('says a project’s health over all its containers, and what is missing', () => {
    const web = row({})
    const db = row({ service: 'db', name: 'shop-db-1', state: 'exited', exitCode: 1 })
    const redis = row({ service: 'redis', name: 'shop-redis-1' })
    expect(healthOf([web, redis])).toEqual({ label: '2 en marche', tone: 'ok' })
    expect(healthOf([web, db, redis])).toEqual({ label: '2 sur 3 · db en échec (code 1)', tone: 'bad' })
    const stopped = { ...redis, state: 'exited' as const, exitCode: 0 }
    expect(healthOf([web, stopped])).toEqual({ label: '1 sur 2 · redis arrêté', tone: 'warn' })
    expect(healthOf([{ ...web, state: 'exited', exitCode: 0 }, stopped])).toEqual({ label: '2 arrêtés', tone: 'off' })
  })

  it('opens a running TCP port on localhost, and shows a port published twice once', () => {
    const p = { hostIp: '0.0.0.0', hostPort: 3000, port: 3000, protocol: 'tcp' }
    expect(portUrl(row({}), p)).toBe('http://localhost:3000')
    expect(portUrl(row({ state: 'exited' }), p)).toBeNull()
    expect(portsOf([p, { ...p, hostIp: '::' }])).toHaveLength(1)
  })
})

describe('Conteneurs (Lunar Industries) · logs', () => {
  it('reads a log line: its time, its text, its level, in capitals or not', () => {
    const l = parseLine('2026-10-01T07:12:03.114000000Z ERROR boom')
    expect(l).toMatchObject({ stamp: '2026-10-01T07:12:03.114000000Z', text: 'ERROR boom', level: 'error' })
    expect(parseLine('sans heure')).toMatchObject({ stamp: '', time: '', text: 'sans heure', level: null })
    expect(parseLine('level=warn msg="slow"').level).toBe('warn')
    expect(parseLine('{"level":"error","msg":"x"}').level).toBe('error')
    expect(parseLine('no errors here: terror').level).toBeNull()
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

  it('marks what the search found, whatever the accents and capitals', () => {
    expect(highlight('Délai dépassé, délai', 'delai')).toEqual([
      { text: 'Délai', hit: true },
      { text: ' dépassé, ', hit: false },
      { text: 'délai', hit: true },
    ])
    expect(highlight('rien', '')).toEqual([{ text: 'rien', hit: false }])
  })

  it('copies the logs with the times the engine wrote', () => {
    expect(logsText([parseLine('2026-10-01T07:00:00Z a'), parseLine('b')])).toBe('2026-10-01T07:00:00Z a\nb\n')
  })
})

describe('Conteneurs (Lunar Industries) · resources', () => {
  it('scales the processor on whole cores and the memory on its limit, not on the highest measure', () => {
    expect(chartTop('cpu', [2, 5], 0)).toBe(100)
    expect(chartTop('cpu', [80, 150], 0)).toBe(200)
    expect(chartTop('memory', [100, 200], 1000)).toBe(1000)
    expect(chartPoints([0, 50], 100).line).toBe('0.00,100.00 100.00,50.00')
    expect(chartPoints([1], 100).line).toBe('')
  })
})
