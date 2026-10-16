// Taken from quack-board (tests/unit/time_log.spec.ts, Simon's « Time log »), through the Time Log's sendDay and
// read (a fake Time Log that keeps one entry per task, label and day, as Notion's does).
import { describe, expect, test } from 'vitest'
import { FakeTimeLog, PlainTimeLog, ReadingTimeLog, setup } from './fakes.ts'

const DAY = '2026-09-22'
const NEXT_DAY = new Date(2026, 8, 23, 9)

describe('Time log', () => {
  test('a day sent makes one entry per task and label', async () => {
    const log = new FakeTimeLog()
    const sent = setup({ now: NEXT_DAY, log })
    await sent.store.draft(DAY, [
      { taskId: 't1', share: 12, props: { 'Type événement': null } },
      { taskId: null, label: 'Réunion', share: 5, confirmed: true },
      // A line without a task kept on purpose, with the same label: one entry with the other.
      { taskId: null, repo: 'r', branch: 'fix', label: 'Réunion', share: 3, confirmed: true },
      { taskId: 't2', share: 0 },
    ])
    sent.tasks.list = [{ id: 't1', title: 'Caméra' }]
    await sent.days.send(DAY)
    expect(log.entries.map((e) => [e.day, e.taskId, e.label, e.share])).toEqual([
      [DAY, 't1', 'Développement', 0.6],
      [DAY, null, 'Réunion', 0.4],
    ])
    expect(await sent.store.drafts(DAY)).toHaveLength(0)
    expect(await sent.days.dayState(DAY)).toBe('recorded')
    expect(sent.changes()).toBeGreaterThan(0)
  })

  test('each task goes with its text from the model, for a Time Log that cannot relate the entry to it', async () => {
    const log = new FakeTimeLog()
    const plane = 'https://plane.example/lunar/issues/LUN-12'
    const sent = setup({ now: NEXT_DAY, log, settings: { taskText: 'Tâche Plane : {ref} — {titre} {url}' } })
    await sent.store.draft(DAY, [
      { taskId: 't1', share: 10 },
      { taskId: null, label: 'Réunion', share: 10, confirmed: true },
    ])
    sent.tasks.list = [{ id: 't1', title: 'Ordre des colonnes', ref: 'LUN-12', url: plane }]
    await sent.days.send(DAY)
    expect(log.lines.map((l) => l.task)).toEqual([
      { id: 't1', title: 'Ordre des colonnes', text: `Tâche Plane : LUN-12 — Ordre des colonnes ${plane}` },
      null,
    ])
  })

  test('by default the text is the task’s address, and nothing for a task that has none', async () => {
    const log = new FakeTimeLog()
    const sent = setup({ now: NEXT_DAY, log })
    await sent.store.draft(DAY, [
      { taskId: 't1', share: 10 },
      { taskId: 't2', share: 10 },
    ])
    sent.tasks.list = [
      { id: 't1', title: 'Plane', url: 'https://plane.example/x/LUN-1' },
      { id: 't2', title: 'Sans adresse' },
    ]
    await sent.days.send(DAY)
    expect(log.lines.map((l) => l.task)).toEqual([
      { id: 't1', title: 'Plane', text: 'https://plane.example/x/LUN-1' },
      { id: 't2', title: 'Sans adresse' },
    ])
  })

  test('sending again rewrites the same entries and removes the lines taken out', async () => {
    const log = new FakeTimeLog()
    const { store, days } = setup({ now: NEXT_DAY, log })
    await store.draft(DAY, [
      { taskId: 't1', share: 10 },
      { taskId: 't2', share: 10 },
    ])
    await days.send(DAY)
    const [first] = log.entries
    await store.draft(DAY, [{ taskId: 't1', share: 20 }])
    await days.send(DAY)
    expect(log.entries.filter((e) => !e.archived).map((e) => [e.id, e.share])).toEqual([[first.id, 1]])
    expect((await store.logged([DAY])).map((r) => [r.taskId, r.share])).toEqual([['t1', 20]])
  })

  test('refuses a day that is not complete, or a branch left unresolved', async () => {
    const log = new FakeTimeLog()
    const { store, days } = setup({ now: NEXT_DAY, log })
    await store.draft(DAY, [{ taskId: 't1', share: 15 }])
    await expect(days.send(DAY)).rejects.toThrow(/valoir 1/)
    await store.draft(DAY, [
      { taskId: 't1', share: 15 },
      { taskId: null, repo: 'r', branch: 'fix', share: 5 },
    ])
    await expect(days.send(DAY)).rejects.toThrow(/branche sans tâche/)
    expect(log.calls).toHaveLength(0)
  })

  test('a Time Log that cannot write a whole day is said so, and nothing is sent', async () => {
    const { store, days } = setup({ now: NEXT_DAY, log: new PlainTimeLog() })
    await store.draft(DAY, [{ taskId: 't1', share: 20 }])
    await expect(days.send(DAY)).rejects.toThrow(/journée entière/)
    expect((await days.view(DAY)).logProblem).toMatch(/journée entière/)
    expect((await setup({ now: NEXT_DAY, log: null }).days.view(DAY)).logProblem).toMatch(/Aucun Time Log/)
  })

  test('a Time Log only read shows its days as recorded, and refuses to be sent one', async () => {
    const entries = new FakeTimeLog()
    entries.entries.push({ id: 'p1', day: DAY, taskId: 't1', label: 'Réunion', share: 1, url: null, props: {}, lastEdited: '', archived: false })
    const { store, days } = setup({ now: NEXT_DAY, log: new ReadingTimeLog(entries) })
    const view = await days.view(DAY)
    expect(view.state).toBe('recorded')
    expect(view.lines.map((l) => [l.source, l.taskId, l.label, l.share])).toEqual([['log', 't1', 'Réunion', 20]])
    expect(view.labels).toContain('Réunion')
    expect(view.logProblem).toMatch(/journée entière/)
    await days.edit(DAY)
    await expect(days.send(DAY)).rejects.toThrow(/journée entière/)
    expect(await store.drafts(DAY)).toHaveLength(1)
  })

  test('a draft under 1 is saved, but not sent', async () => {
    const log = new FakeTimeLog()
    const { store, days } = setup({ now: NEXT_DAY, log })
    await days.replace(DAY, [{ taskId: 't1', label: 'Développement', share: 18 }])
    expect((await store.drafts(DAY)).map((l) => [l.taskId, l.share])).toEqual([['t1', 18]])
    await expect(days.send(DAY)).rejects.toThrow(/valoir 1/)
    expect(log.calls).toHaveLength(0)
  })

  test('« Absent » sends one line of a whole day without a task', async () => {
    const log = new FakeTimeLog()
    const { days } = setup({ now: NEXT_DAY, log })
    await days.absent(DAY)
    await days.send(DAY)
    expect(log.entries.map((e) => [e.taskId, e.label, e.share])).toEqual([[null, 'Absent', 1]])
    expect(await days.dayState(DAY)).toBe('absent')
  })

  test('the app shows what the Time Log has, after an edit made there', async () => {
    const log = new FakeTimeLog()
    const { store, days } = setup({ now: NEXT_DAY, log })
    await store.draft(DAY, [
      { taskId: 't1', share: 10 },
      { taskId: 't2', share: 10 },
    ])
    await days.send(DAY)
    // Changed directly in the Time Log: one entry gets the whole day, the other is removed.
    log.entries[0].share = 1
    log.entries[1].archived = true
    await days.readLog(DAY, DAY, true)
    expect((await store.logged([DAY])).map((r) => [r.taskId, r.share])).toEqual([['t1', 20]])
  })

  test('« Relire le Time Log » reads it again at once, and says why when it cannot', async () => {
    const log = new FakeTimeLog()
    const { store, days } = setup({ now: NEXT_DAY, log })
    await store.draft(DAY, [{ taskId: 't1', share: 20 }])
    await days.send(DAY)
    await days.readLog(DAY, DAY)
    log.entries[0].share = 0.5
    // Read moments ago: an ordinary reading keeps the mirror, « Relire » does not wait.
    await days.readLog(DAY, DAY)
    expect((await store.logged([DAY])).map((r) => r.share)).toEqual([20])
    await days.reread(DAY)
    expect((await store.logged([DAY])).map((r) => r.share)).toEqual([10])
    log.read = async () => {
      throw new Error('Notion 502')
    }
    await expect(days.reread(DAY)).rejects.toThrow(/Time Log non relu : Notion 502/)
  })

  test('two readings asked together wait for the same one: nobody sees a mirror not yet filled', async () => {
    class SlowTimeLog extends FakeTimeLog {
      release: () => void = () => {}
      #gate = new Promise<void>((resolve) => (this.release = resolve))
      async read(from: string, to: string) {
        await this.#gate
        return super.read(from, to)
      }
    }
    const log = new SlowTimeLog()
    log.entries.push({ id: 'p1', day: DAY, taskId: 't1', label: 'Développement', share: 1, url: null, props: {}, lastEdited: '', archived: false })
    const { store, days } = setup({ now: NEXT_DAY, log })
    const first = days.readLog(DAY, DAY)
    let second = false
    const waiting = days.readLog(DAY, DAY).then(() => (second = true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(second).toBe(false)
    log.release()
    await Promise.all([first, waiting])
    expect((await store.logged([DAY])).map((r) => r.taskId)).toEqual(['t1'])
  })

  test('each line says its task’s title and reference, a task the user has no role in included', async () => {
    const { store, tasks, days } = setup({ now: NEXT_DAY })
    // The core's tasks: the user's, and Camille's, whose branch the user committed on.
    tasks.list = [
      { id: 't1', title: 'Export CSV', ref: 'TSK-412' },
      { id: 't2', title: 'Paiement en trois fois', ref: 'TSK-398' },
    ]
    await days.replace(DAY, [
      { taskId: 't1', label: 'Développement', share: 10 },
      { taskId: 't2', label: 'Développement', share: 5 },
      { taskId: 't9', label: 'Développement', share: 5 },
      { taskId: null, label: 'Réunion', share: 0, confirmed: true },
    ])
    const view = await days.view(DAY)
    expect(view.lines.map((l) => [l.taskId, l.taskTitle, l.taskRef])).toEqual([
      ['t1', 'Export CSV', 'TSK-412'],
      ['t2', 'Paiement en trois fois', 'TSK-398'],
      ['t9', null, null],
      [null, null, null],
    ])
  })

  test('a draft the user changed says so, until it is dropped', async () => {
    const { days } = setup({ now: NEXT_DAY })
    expect((await days.view(DAY)).edited).toBe(false)
    await days.replace(DAY, [{ taskId: 't1', label: 'Développement', share: 20 }])
    expect((await days.view(DAY)).edited).toBe(true)
    await days.discard(DAY)
    expect((await days.view(DAY)).edited).toBe(false)
  })

  test('« Modifier » makes a recorded day a draft again, sent back over the same entries', async () => {
    const log = new FakeTimeLog()
    const { store, days } = setup({ now: NEXT_DAY, log })
    await store.draft(DAY, [{ taskId: 't1', share: 20 }])
    await days.send(DAY)
    await days.edit(DAY)
    expect(await days.dayState(DAY)).toBe('modified')
    const view = await days.view(DAY)
    expect(view.lines.map((l) => [l.source, l.taskId, l.share])).toEqual([['draft', 't1', 20]])
    await days.send(DAY)
    expect(log.entries.filter((e) => !e.archived)).toHaveLength(1)
    expect(await days.dayState(DAY)).toBe('recorded')
  })
})
