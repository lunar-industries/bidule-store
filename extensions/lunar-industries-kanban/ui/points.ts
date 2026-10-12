import { useContributions, useSettingValues, type PointData, type SettingValues, type TaskGroup } from '@bidule/sdk'

// The point `kanban` (contributes.points in bidule.json), the same as the official Kanban's: what the other extensions
// give the cards (advice, badges, right-click actions), read here as by any Kanban. Its checks and the filter of the
// actions are this module's own copy: an extension never imports another one's code.
export type KanbanAction = PointData<'kanban'>['actions'][number]

const GROUPS: TaskGroup[] = ['todo', 'doing', 'done']
const isGroup = (value: unknown): value is TaskGroup => GROUPS.some((g) => g === value)

// A card action as the point's contract says it: one of the contributing extension's commands and a title, known
// groups, a setting of that extension's own; null otherwise.
function readAction(raw: unknown, extension: string, commands: string[]): KanbanAction | null {
  if (typeof raw !== 'object' || raw === null || !('command' in raw) || !('title' in raw)) return null
  const { command, title } = raw
  if (typeof command !== 'string' || typeof title !== 'string' || !commands.includes(command)) return null
  const action: KanbanAction = { command, title }
  if ('groups' in raw && raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) return null
    const groups = raw.groups.filter(isGroup)
    if (groups.length !== raw.groups.length) return null
    action.groups = groups
  }
  if ('setting' in raw && raw.setting !== undefined) {
    if (typeof raw.setting !== 'string' || !raw.setting.startsWith(`${extension}.`)) return null
    action.setting = raw.setting
  }
  return action
}

// What was refused is said once: each reading checks the contributions again.
const warned = new Set<string>()

// A contribution's data: its valid actions (none when it gives none); an invalid one is dropped, with a warning
// naming the extension said once, and a contribution whose actions are not a list is refused.
export function parseKanban(data: unknown, extension: string, commands: string[]): PointData<'kanban'> | null {
  const raw = typeof data === 'object' && data !== null && 'actions' in data ? data.actions : []
  if (!Array.isArray(raw)) return null
  return {
    actions: raw.flatMap((a: unknown) => {
      const action = readAction(a, extension, commands)
      const key = `${extension}\n${JSON.stringify(a)}`
      if (!action && !warned.has(key)) {
        warned.add(key)
        console.warn(`${extension} : une action de carte invalide est écartée`, a)
      }
      return action ? [action] : []
    }),
  }
}

// The actions a card of this group offers, the settings being these: only on the tasks of its groups, and only while
// its setting is on, when it says so.
export function cardActions(actions: KanbanAction[], group: TaskGroup | null, values: SettingValues | null): KanbanAction[] {
  return actions.filter(
    (a) => (!a.groups || (group !== null && a.groups.includes(group))) && (!a.setting || values?.[a.setting] === true),
  )
}

// What the other extensions give the cards: the interfaces' parts (advice, badges) and the right-click actions, with
// the actions of a card by its task's group.
export function useKanbanContributions() {
  const contributions = useContributions('kanban', parseKanban)
  const values = useSettingValues()
  const actions = contributions.flatMap((c) => c.data.actions)
  return {
    parts: contributions.flatMap((c) => (c.ui ? [{ id: c.extension, kanban: c.ui }] : [])),
    actions,
    actionsFor: (group: TaskGroup | null) => cardActions(actions, group, values),
  }
}
