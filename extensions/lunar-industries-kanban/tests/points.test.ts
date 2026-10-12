import { afterEach, describe, expect, test, vi } from 'vitest'
import { cardActions, parseKanban, type KanbanAction } from '../ui/points.ts'

afterEach(() => vi.restoreAllMocks())

// The commands the contributing extension declares (the core gives them with each contribution).
const commands = ['notes.start', 'notes.later', 'notes.session', 'notes.untitled', 'notes.kept']

describe('parseKanban', () => {
  test('keeps a valid action, with its groups and its own setting', () => {
    const action = { command: 'notes.start', title: 'Démarrer', groups: ['todo'], setting: 'notes.enabled' }
    expect(parseKanban({ actions: [action] }, 'notes', commands)).toEqual({ actions: [action] })
  })

  test('drops an unknown group, a setting of another extension, an action without a title and one whose command the extension does not declare, with a warning said once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const data = {
      actions: [
        { command: 'notes.later', title: 'Plus tard', groups: ['later'] },
        { command: 'notes.session', title: 'Session', setting: 'claude.enabled' },
        { command: 'notes.untitled' },
        { command: 'notes.unknown', title: 'Inconnue' },
        { command: 'notes.kept', title: 'Gardée' },
      ],
    }
    expect(parseKanban(data, 'notes', commands)).toEqual({ actions: [{ command: 'notes.kept', title: 'Gardée' }] })
    expect(warn).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('notes'), { command: 'notes.unknown', title: 'Inconnue' })
    // Read again (a contributionsChanged): nothing said twice.
    parseKanban(data, 'notes', commands)
    expect(warn).toHaveBeenCalledTimes(4)
  })

  test('gives no actions to a contribution without any, and refuses actions that are not a list', () => {
    expect(parseKanban({}, 'notes', commands)).toEqual({ actions: [] })
    expect(parseKanban({ actions: 'all' }, 'notes', commands)).toBeNull()
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
