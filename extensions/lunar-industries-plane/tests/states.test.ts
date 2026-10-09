import { describe, expect, test } from 'vitest'
import { columnsOf, groupOf, listOf, notionIdsOf, paletteOf, pickState, refOf, wantedProjects, webUrl } from '../server/states.ts'
import { item, state, STATES } from './fakes.ts'

describe('the columns', () => {
  test('Plane’s five groups make the board’s three, a cancelled item being closed', () => {
    expect(['backlog', 'unstarted', 'started', 'completed', 'cancelled', 'autre'].map(groupOf)).toEqual([
      'todo',
      'todo',
      'doing',
      'done',
      'done',
      'todo',
    ])
  })

  test('one column a name and group, the groups in Plane’s order and each group by sequence', () => {
    const states = [
      state('1', 'Terminé', 'completed', 9),
      state('2', 'En revue', 'started', 7),
      state('3', 'À faire', 'unstarted', 5),
      state('4', 'En cours', 'started', 6),
      // The same state in another project, or in Plane's other group the board counts as « to do »: one column.
      state('5', 'À faire', 'unstarted', 1),
      state('6', 'À faire', 'backlog', 1),
      // The same name in another group of the board: another column.
      state('7', 'En revue', 'completed', 1),
    ]
    expect(columnsOf(states).map((c) => [c.name, c.group])).toEqual([
      ['À faire', 'todo'],
      ['En cours', 'doing'],
      ['En revue', 'doing'],
      ['En revue', 'done'],
      ['Terminé', 'done'],
    ])
  })
})

describe('the state a card goes to', () => {
  test('the state of that name, else the first of the group, else none', () => {
    expect(pickState(STATES, 'En revue', 'doing')?.id).toBe('s-review')
    // Notion’s « En attente » does not exist in the project: the first state of its group.
    expect(pickState(STATES, 'En attente', 'doing')?.id).toBe('s-doing')
    expect(pickState(STATES, 'Fini', 'done')?.id).toBe('s-done')
    expect(pickState(STATES, 'Inconnu', null)).toBeNull()
    expect(pickState([], 'Fini', 'done')).toBeNull()
  })
})

describe('the work items', () => {
  test('a reference and an address as Plane’s web interface makes them', () => {
    const project = { id: 'p1', name: 'Accenta', identifier: 'ACC' }
    const ref = refOf(project, item('w1', 'Titre', { sequenceId: 123 }))
    expect(ref).toBe('ACC-123')
    expect(webUrl({ base: 'https://plane.test', workspace: 'accenta' }, ref)).toBe(
      'https://plane.test/accenta/browse/ACC-123/'
    )
  })

  test('the Notion pages a description names, with or without dashes, once each', () => {
    const dashed = '1f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
    const html = `<p>Migrée de <a href="https://notion.so/Titre-${dashed.replaceAll('-', '')}">la tâche</a> (${dashed.toUpperCase()}).</p>`
    expect(notionIdsOf(html)).toEqual([dashed])
    expect(notionIdsOf('<p>Rien à voir</p>')).toEqual([])
    expect(notionIdsOf(null)).toEqual([])
  })

  test('the projects read are those named by identifier, whatever the case, else all', () => {
    const all = [
      { id: 'a', name: 'Accenta', identifier: 'ACC' },
      { id: 'b', name: 'Site', identifier: 'WEB' },
    ]
    expect(wantedProjects(all, ['acc']).map((p) => p.id)).toEqual(['a'])
    expect(wantedProjects(all, []).map((p) => p.id)).toEqual(['a', 'b'])
    expect(wantedProjects(all, ['inconnu'])).toEqual([])
  })

  test('a list typed in a setting', () => {
    expect(listOf('ACC, WEB;  API\nDOC')).toEqual(['ACC', 'WEB', 'API', 'DOC'])
    expect(listOf('')).toEqual([])
  })
})

describe('colours', () => {
  test("a state's colour becomes the app's nearest, a grey one neutral", () => {
    expect(paletteOf('#F87171')).toBe('coral')
    expect(paletteOf('#F59E0B')).toBe('butter')
    expect(paletteOf('#22C55E')).toBe('mint')
    expect(paletteOf('#3B82F6')).toBe('blue')
    expect(paletteOf('#8B5CF6')).toBe('violet')
    expect(paletteOf('#EC4899')).toBe('pink')
    expect(paletteOf('#9CA3AF')).toBe('neutral')
    expect(paletteOf('')).toBe('neutral')
  })
})
