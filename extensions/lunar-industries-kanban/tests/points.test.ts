import { afterEach, describe, expect, test, vi } from 'vitest'
import { cardActions, parseKanban, type KanbanAction } from '../ui/points.ts'

afterEach(() => vi.restoreAllMocks())

describe('parseKanban', () => {
  test('keeps a valid action, with its groups and its own setting', () => {
    const action = { command: 'notes.start', title: 'Démarrer', groups: ['todo'], setting: 'notes.enabled' }
    expect(parseKanban({ actions: [action] }, 'notes')).toEqual({ actions: [action] })
  })

  test('drops an unknown group, a setting of another extension and an action without a title, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = parseKanban(
      {
        actions: [
          { command: 'notes.later', title: 'Plus tard', groups: ['later'] },
          { command: 'notes.session', title: 'Session', setting: 'claude.enabled' },
          { command: 'notes.untitled' },
          { command: 'notes.kept', title: 'Gardée' },
        ],
      },
      'notes',
    )
    expect(parsed).toEqual({ actions: [{ command: 'notes.kept', title: 'Gardée' }] })
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('notes'), expect.anything())
  })

  test('gives no actions to a contribution without any, and refuses actions that are not a list', () => {
    expect(parseKanban({}, 'notes')).toEqual({ actions: [] })
    expect(parseKanban({ actions: 'all' }, 'notes')).toBeNull()
  })
})

describe('cardActions', () => {
  const actions: KanbanAction[] = [
    { command: 'branches.createBranch', title: 'Créer une branche…' },
    { command: 'claude.start', title: 'Démarrer…', groups: ['todo'], setting: 'claude.enabled' },
    { command: 'claude.session', title: 'Session Claude…', setting: 'claude.enabled' },
  ]
  const titles = (list: KanbanAction[]) => list.map((a) => a.title)

  test('keeps an action without conditions on every card', () => {
    expect(titles(cardActions(actions, 'done', null))).toEqual(['Créer une branche…'])
  })

  test('shows an action only while its setting is on, and on the tasks of its groups', () => {
    const on = { 'claude.enabled': true }
    expect(titles(cardActions(actions, 'todo', on))).toEqual(['Créer une branche…', 'Démarrer…', 'Session Claude…'])
    expect(titles(cardActions(actions, 'doing', on))).toEqual(['Créer une branche…', 'Session Claude…'])
    expect(titles(cardActions(actions, null, on))).toEqual(['Créer une branche…', 'Session Claude…'])
  })
})
