import { actionsFor, parseTaskPoint, useContributions, type TaskAction, type TaskGroup } from '@bidule/sdk'

// The actions the other modules offer on a task (the core's point `task`, `contributes.to.task.actions`), for the
// card's menu: the same ones the core's own menu shows. The board keeps its own card and menu until Piloter takes over
// (phase 5 of the redesign).
export function useTaskActions() {
  const contributions = useContributions('task', parseTaskPoint)
  const actions: TaskAction[] = contributions.flatMap((c) => c.data.actions)
  return { actions, actionsFor: (group: TaskGroup | null) => actionsFor(actions, group) }
}
