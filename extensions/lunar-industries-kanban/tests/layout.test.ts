import type { Board, Task } from '@bidule/sdk'
import { describe, expect, test } from 'vitest'
import type { KanbanBranch } from '../contract.ts'
import {
  applicableMerges,
  attentionOf,
  badgeOf,
  boardColumns,
  branchKey,
  branchLabel,
  choiceOf,
  columnColor,
  columnOf,
  groupsOf,
  linkRows,
  marksOf,
  matchesFilter,
  matchesQuery,
  moveCandidates,
  moveName,
  noteOf,
  openings,
  orderColumns,
  orphansOf,
  parseMerges,
  shortBranch,
  sortTasks,
  withChoice,
  type TaskContext,
} from '../ui/layout.ts'

const task = (id: string, status: string, patch: Partial<Task> = {}): Task => ({
  id,
  type: 'task',
  provider: 'notion',
  properties: {},
  title: `Tâche ${id}`,
  status,
  group: status === 'Terminé' ? 'done' : status === 'En cours' ? 'doing' : 'todo',
  ref: null,
  url: null,
  role: 'owner',
  lastEdited: null,
  due: null,
  ...patch,
})

const board: Board = {
  source: 'Notion',
  configured: true,
  columns: [
    { name: 'À faire', color: 'neutral', group: 'todo' },
    { name: 'Backlog', color: 'neutral', group: 'todo' },
    { name: 'En cours', color: 'blue', group: 'doing' },
    { name: 'Terminé', color: 'mint', group: 'done' },
  ],
  tasks: [task('1', 'À faire'), task('2', 'En cours'), task('3', 'Terminé'), task('4', 'Archivé')],
}

const branch = (name: string, patch: Partial<KanbanBranch> = {}): KanbanBranch => ({
  repo: '/r/app',
  repoLabel: 'app',
  name,
  taskId: null,
  isDefault: false,
  lastCommitAt: new Date().toISOString(),
  reviewNumber: null,
  reviewRef: null,
  reviewState: null,
  ci: null,
  url: null,
  ...patch,
})

describe('columns', () => {
  test('consecutive columns of a group share its heading; a status the source dropped stands alone', () => {
    const groups = groupsOf(board, [], new Set())
    expect(groups.map((g) => [g.label, g.columns.map((c) => c.name)])).toEqual([
      ['À faire', ['À faire', 'Backlog']],
      ['En cours', ['En cours']],
      ['Terminé', ['Terminé']],
      ['', ['Archivé']],
    ])
    expect(groups.at(-1)!.columns[0].unknown).toBe(true)
  })

  test('finished columns start folded, unless the user unfolded them; folded ones take no spare width', () => {
    const folded = groupsOf(board, [], new Set())
    expect(folded[2].columns[0].folded).toBe(true)
    expect(folded[2].grow).toBe(0)
    expect(folded[0].grow).toBe(2)
    const open = groupsOf(board, [], new Set(['Terminé', 'Backlog']))
    expect(open[2].columns[0].folded).toBe(false)
    expect(open[0].columns[1].folded).toBe(true)
  })

  test('two tools listed one after the other: the columns by stage, in the order they come otherwise', () => {
    const two: Board = {
      ...board,
      columns: [
        { name: 'Backlog', color: 'neutral', group: 'todo' },
        { name: 'En cours', color: 'blue', group: 'doing' },
        { name: 'Closed', color: 'mint', group: 'done' },
        { name: 'En standby', color: 'neutral', group: 'todo' },
        { name: 'En cours/dev', color: 'blue', group: 'doing' },
        { name: 'Deployée/Fini', color: 'mint', group: 'done' },
      ],
      tasks: [],
    }
    expect(groupsOf(two, [], new Set()).map((g) => [g.key, g.columns.map((c) => c.name)])).toEqual([
      ['todo', ['Backlog', 'En standby']],
      ['doing', ['En cours', 'En cours/dev']],
      ['done', ['Closed', 'Deployée/Fini']],
    ])
  })

  test('hidden columns are left out', () => {
    expect(groupsOf(board, ['Backlog'], new Set())[0].columns.map((c) => c.name)).toEqual(['À faire'])
  })
})

describe('the columns in the order the user chose', () => {
  const names = ['À faire', 'Backlog', 'En cours', 'Terminé']

  test('the saved order, a status it does not have yet after the one before it in the source, a gone one left out', () => {
    expect(orderColumns(names, [])).toEqual(names)
    expect(orderColumns(names, ['En cours', 'À faire', 'Backlog', 'Terminé'])).toEqual(['En cours', 'À faire', 'Backlog', 'Terminé'])
    // « Backlog » is new: after « À faire », which comes before it in the source.
    expect(orderColumns(names, ['Terminé', 'À faire', 'En cours'])).toEqual(['Terminé', 'À faire', 'Backlog', 'En cours'])
    // « À faire » is new and first in the source: first.
    expect(orderColumns(names, ['En cours', 'Backlog', 'Terminé', 'Supprimé'])).toEqual(['À faire', 'En cours', 'Backlog', 'Terminé'])
  })

  test('a status moved to a gap of the list', () => {
    expect(moveName(names, 'Terminé', 0)).toEqual(['Terminé', 'À faire', 'Backlog', 'En cours'])
    expect(moveName(names, 'À faire', 4)).toEqual(['Backlog', 'En cours', 'Terminé', 'À faire'])
    expect(moveName(names, 'À faire', 2)).toEqual(['Backlog', 'À faire', 'En cours', 'Terminé'])
    expect(moveName(names, 'À faire', 1)).toEqual(names)
    expect(moveName(names, 'Inconnu', 0)).toEqual(names)
  })

  test('the board follows it; the neighbouring columns of a stage make a group, a stage apart makes another', () => {
    expect(boardColumns(board.columns, ['En cours', 'À faire', 'Backlog', 'Terminé']).map((c) => c.name)).toEqual([
      'En cours',
      'À faire',
      'Backlog',
      'Terminé',
    ])
    const groups = groupsOf(board, [], new Set(), new Map(), ['À faire', 'En cours', 'Backlog', 'Terminé'])
    expect(groups.map((g) => [g.key, g.columns.map((c) => c.name)])).toEqual([
      ['todo', ['À faire']],
      ['doing', ['En cours']],
      ['todo', ['Backlog']],
      ['done', ['Terminé']],
      ['col:Archivé', ['Archivé']],
    ])
  })

  test('each status is shown, hidden or merged into another; it is in one setting at most', () => {
    const merges = new Map([['Backlog', 'À faire']])
    expect(choiceOf('Backlog', [], merges)).toEqual({ kind: 'merged', into: 'À faire' })
    expect(choiceOf('Backlog', ['Backlog'], merges)).toEqual({ kind: 'hidden' })
    expect(choiceOf('En cours', [], merges)).toEqual({ kind: 'shown' })
    const hidden = withChoice('Backlog', { kind: 'hidden' }, [], merges)
    expect([hidden.hidden, [...hidden.merges]]).toEqual([['Backlog'], []])
    const merged = withChoice('En cours', { kind: 'merged', into: 'À faire' }, ['En cours'], merges)
    expect([merged.hidden, [...merged.merges]]).toEqual([[], [['Backlog', 'À faire'], ['En cours', 'À faire']]])
    const shown = withChoice('Backlog', { kind: 'shown' }, ['Backlog'], merges)
    expect([shown.hidden, [...shown.merges]]).toEqual([[], []])
  })
})

describe('what a card opens', () => {
  const providers = [
    { id: 'notion', title: 'Notion' },
    { id: 'plane', title: 'Plane' },
  ]

  test('one line per tool the task is in, the owner first, named as the app names its provider', () => {
    const migrated = {
      ...task('1', 'En cours', { provider: 'notion', url: 'https://notion/1' }),
      sources: [
        { provider: 'notion', ref: 'TSK-1', url: 'https://notion/1' },
        { provider: 'plane', ref: 'PLA-1', url: 'https://plane/1' },
      ],
    }
    expect(openings(migrated, providers)).toEqual([
      { provider: 'notion', title: 'Notion', url: 'https://notion/1' },
      { provider: 'plane', title: 'Plane', url: 'https://plane/1' },
    ])
  })

  test('only the active providers, and only where the tool gives an address', () => {
    const t = {
      ...task('1', 'En cours'),
      sources: [
        { provider: 'notion', ref: null, url: null },
        { provider: 'plane', ref: 'PLA-1', url: 'https://plane/1' },
        { provider: 'jira', ref: 'J-1', url: 'https://jira/1' },
      ],
    }
    expect(openings(t, providers).map((o) => o.title)).toEqual(['Plane'])
  })

  test("an older core gives the owner's source alone", () => {
    expect(openings(task('1', 'En cours', { provider: 'plane', url: 'https://plane/1' }), providers)).toEqual([
      { provider: 'plane', title: 'Plane', url: 'https://plane/1' },
    ])
    expect(openings(task('1', 'En cours', { provider: 'plane', url: null }), providers)).toEqual([])
  })
})

describe('statuses merged into another column', () => {
  const names = board.columns.map((c) => c.name)

  test('the setting is read as { from: into }; anything else, or a status merged into itself, is ignored', () => {
    expect([...parseMerges('{"Backlog":"À faire","En cours":"En cours","x":3}')]).toEqual([['Backlog', 'À faire']])
    expect(parseMerges('["Backlog"]').size).toBe(0)
    expect(parseMerges('pas du JSON').size).toBe(0)
    expect(parseMerges(undefined).size).toBe(0)
  })

  test('a merge naming a status the source does not list is left out; a chain ends where it ends; a loop is dropped', () => {
    expect([...applicableMerges(new Map([['Backlog', 'Renommé']]), names)]).toEqual([])
    expect([...applicableMerges(new Map([['Backlog', 'À faire'], ['À faire', 'En cours']]), names)]).toEqual([
      ['Backlog', 'En cours'],
      ['À faire', 'En cours'],
    ])
    expect([...applicableMerges(new Map([['Backlog', 'À faire'], ['À faire', 'Backlog']]), names)]).toEqual([])
  })

  test("a merged status has no column; its tasks sit in the column that took it, which says what it also shows", () => {
    const merges = applicableMerges(new Map([['Backlog', 'À faire']]), names)
    const merged: Board = { ...board, tasks: [task('1', 'À faire'), task('5', 'Backlog')] }
    const [todo] = groupsOf(merged, [], new Set(), merges)
    expect(todo.columns.map((c) => [c.name, c.merged, c.tasks.map((t) => t.id)])).toEqual([['À faire', ['Backlog'], ['1', '5']]])
    expect(todo.grow).toBe(1)
    expect(columnOf(merged.tasks[1], merges)).toBe('À faire')
  })

  test("a drop tries the statuses the task's tool already uses first, then the column's own, then the merged ones", () => {
    const merges = new Map([['En cours/dev', 'En cours'], ['Dev', 'En cours']])
    const tasks = [task('1', 'En cours/dev', { provider: 'notion' }), task('2', 'En cours', { provider: 'plane' })]
    expect(moveCandidates({ provider: 'notion' }, 'En cours', merges, tasks)).toEqual(['En cours/dev', 'En cours', 'Dev'])
    expect(moveCandidates({ provider: 'plane' }, 'En cours', merges, tasks)).toEqual(['En cours', 'En cours/dev', 'Dev'])
    expect(moveCandidates({ provider: 'plane' }, 'À faire', merges, tasks)).toEqual(['À faire'])
  })
})

describe('badges and notes', () => {
  const today = '2026-10-01'
  test('only a late task stands out; today is said, a later date written, a finished task has none', () => {
    expect(badgeOf(task('1', 'x', { due: '2026-09-28' }), false, today)).toEqual({ text: 'en retard · 3 j', tone: 'accent' })
    expect(badgeOf(task('1', 'x', { due: '2026-10-01T09:00:00' }), false, today)).toEqual({ text: "aujourd'hui", tone: 'warn' })
    expect(badgeOf(task('1', 'x', { due: '2026-10-03' }), false, today)?.tone).toBe('neutral')
    expect(badgeOf(task('1', 'x', { due: '2026-09-28' }), true, today)).toBeNull()
    expect(badgeOf(task('1', 'x'), false, today)).toBeNull()
  })

  test('the note says a task the user only takes part in, and one unchanged for two weeks', () => {
    const now = Date.parse('2026-10-20T12:00:00Z')
    expect(noteOf({ role: 'participant', lastEdited: '2026-10-19T12:00:00Z' }, false, now)).toBe('participant')
    expect(noteOf({ role: 'owner', lastEdited: '2026-10-01T12:00:00Z' }, false, now)).toBe('inchangée depuis 19 j')
    expect(noteOf({ role: 'owner', lastEdited: '2026-10-01T12:00:00Z' }, true, now)).toBeNull()
    expect(noteOf({ role: 'owner', lastEdited: null }, false, now)).toBeNull()
  })
})

describe('branches', () => {
  test('the card shows its first branch in full, the others counted; nothing without one', () => {
    expect(branchLabel([branch('feat/TSK-1-a'), branch('fix/TSK-1-b')])).toBe('feat/TSK-1-a +1')
    expect(branchLabel([])).toBe('')
    // The panel and the dialog still shorten a name where it helps.
    expect(shortBranch('feat/TSK-42-export-csv')).toBe('export-csv')
  })

  test('the panel holds the recent branches without a task, not merged', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    const list = [
      branch('recent', { lastCommitAt: '2026-09-30T12:00:00Z' }),
      branch('old', { lastCommitAt: '2026-09-01T12:00:00Z' }),
      branch('linked', { lastCommitAt: '2026-09-30T12:00:00Z', taskId: 't' }),
      branch('merged', { lastCommitAt: '2026-09-30T12:00:00Z', reviewState: 'merged' }),
    ]
    expect(orphansOf(list, now).map((b) => b.name)).toEqual(['recent'])
  })

  test('a branch linked to a task the board does not show is in the panel too', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    const list = [
      branch('shown', { lastCommitAt: '2026-09-30T12:00:00Z', taskId: 't1' }),
      branch('hidden-task', { lastCommitAt: '2026-09-30T12:00:00Z', taskId: 'gone' }),
    ]
    expect(orphansOf(list, now, new Set(['t1'])).map((b) => b.name)).toEqual(['hidden-task'])
  })

  test('a branch has its review mark, then its CI while it matters; a merged one says so, without CI', () => {
    const marks = marksOf([
      branch('a', { reviewRef: 'MR !12', reviewNumber: 12, ci: 'fail', url: 'https://r/12' }),
      branch('b', { ci: 'pending' }),
      branch('c', { ci: 'none' }),
      branch('d', { reviewNumber: 9, reviewState: 'merged', ci: 'merged' }),
    ])
    expect(marks.map((m) => [m.text, m.tone])).toEqual([
      ['!12', 'neutral'],
      ['CI rouge', 'bad'],
      ['CI en cours', 'info'],
      ['#9 fusionnée', 'neutral'],
    ])
    expect(marks[0].url).toBe('https://r/12')
  })

  test('the dialog lists the task’s branches first, then free ones, then the others’, merged last', () => {
    const list = [
      branch('merged', { reviewState: 'merged' }),
      branch('other', { taskId: 'x' }),
      branch('free'),
      branch('mine', { taskId: 't' }),
      branch('elsewhere', { repo: '/r/lib', repoLabel: 'lib' }),
    ]
    const rows = linkRows(list, 't', '', () => 'Une autre', new Set([branchKey(list[3])]))
    expect(rows.map((r) => r.name)).toEqual(['mine', 'free', 'other', 'merged', 'elsewhere'])
    expect(rows[0].checked).toBe(true)
    expect(rows[2].note).toBe('liée à Une autre')
    expect(linkRows(list, 't', 'LIB', () => '', new Set()).map((r) => r.name)).toEqual(['elsewhere'])
  })
})

describe('finding a task', () => {
  const today = '2026-10-01'
  const tasks = [
    task('late', 'À faire', { due: '2026-09-28', title: 'Exporter en CSV', ref: 'TSK-1' }),
    task('today', 'En cours', { due: '2026-10-01', role: 'participant' }),
    task('later', 'À faire', { due: '2026-10-09' }),
    task('none', 'À faire'),
    task('done', 'Terminé', { due: '2026-09-01' }),
  ]
  const branches = new Map([['today', [branch('feat/x', { ci: 'fail' })]]])
  const ctx: TaskContext = { done: (t) => t.status === 'Terminé', branches: (t) => branches.get(t.id) ?? [], today }

  test('the filters: a role, late, due today, a failing CI; a finished task is never late', () => {
    const ids = (filter: Parameters<typeof matchesFilter>[1]) => tasks.filter((t) => matchesFilter(t, filter, ctx)).map((t) => t.id)
    expect(ids('participant')).toEqual(['today'])
    expect(ids('late')).toEqual(['late'])
    expect(ids('today')).toEqual(['today'])
    expect(ids('ci')).toEqual(['today'])
    expect(ids('all')).toHaveLength(5)
    expect(attentionOf(tasks, ctx)).toEqual({ late: 1, today: 1, ci: 1 })
  })

  test('the search looks in the title, the reference and the branches, accents and case aside', () => {
    expect(matchesQuery(tasks[0], 'csv tsk-1', [])).toBe(true)
    expect(matchesQuery(tasks[0], 'EXPORTER', [])).toBe(true)
    expect(matchesQuery(tasks[1], 'feat/x', branches.get('today')!)).toBe(true)
    expect(matchesQuery(tasks[2], 'csv', [])).toBe(false)
  })

  test('a column puts the late tasks first, then by due date, those without one last', () => {
    expect(sortTasks(tasks, today).map((t) => t.id)).toEqual(['done', 'late', 'today', 'later', 'none'])
  })
})

describe('columnColor', () => {
  test("gives the colour of a status of these names, the provider's otherwise", () => {
    expect(columnColor({ name: 'En cours', color: 'butter', group: 'doing' })).toBe('var(--col-doing)')
    expect(columnColor({ name: 'Prod', color: 'mint', group: 'done' })).toBe('var(--col-prod)')
    expect(columnColor({ name: 'Idées', color: 'pink', group: 'todo' })).toBe('var(--pink)')
  })
})
