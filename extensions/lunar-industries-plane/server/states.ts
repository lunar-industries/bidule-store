import type { ColumnColor, TaskGroup } from '@bidule/sdk/objects'
import type { PlaneProject, PlaneState, PlaneWorkItem } from './client.ts'

// A state as a column of the board: Plane's own colour (#rrggbb), turned into the app's palette when put in the core.
export type PlaneColumn = { name: string; group: TaskGroup; color: string }

// The app's colour nearest a state's (by its hue; a grey one is neutral).
export function paletteOf(hex: string): ColumnColor {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return 'neutral'
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 0.15) return 'neutral'
  const d = max - min
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
  if (h < 20 || h >= 345) return 'coral'
  if (h < 70) return 'butter'
  if (h < 170) return 'mint'
  if (h < 250) return 'blue'
  if (h < 290) return 'violet'
  return 'pink'
}

/** Where the work items are: the instance's address and the workspace, which the web addresses are made of. */
export type PlaneSite = { base: string; workspace: string }

// Plane has five groups of states, the board three. A cancelled item is closed, like a completed one.
export function groupOf(group: string): TaskGroup {
  if (group === 'started') return 'doing'
  if (group === 'completed' || group === 'cancelled') return 'done'
  return 'todo'
}

// A work item's reference (« ACC-123 »), and its address in Plane's web interface.
export const refOf = (project: PlaneProject, item: PlaneWorkItem) => `${project.identifier}-${item.sequenceId}`
export const webUrl = (site: PlaneSite, ref: string) => `${site.base}/${site.workspace}/browse/${ref}/`

// A Notion page id, with or without dashes.
const NOTION_ID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi

const dashed = (hex: string) => {
  const h = hex.replaceAll('-', '').toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * The Notion page ids a work item's description names: the migration put the link to the task and its id there. Only
 * those that are tasks the user has in Notion count (the caller checks); nothing else is ever guessed, the title
 * included.
 */
export function notionIdsOf(description: string | null | undefined): string[] {
  return [...new Set((description?.match(NOTION_ID) ?? []).map(dashed))]
}

// Plane lists its groups in this order; the sequence of a state only orders it among those of its group.
const GROUP_ORDER = ['backlog', 'unstarted', 'started', 'completed', 'cancelled']
const rankOf = (group: string) => {
  const i = GROUP_ORDER.indexOf(group)
  return i < 0 ? GROUP_ORDER.length : i
}
const byOrder = (a: PlaneState, b: PlaneState) => rankOf(a.group) - rankOf(b.group) || (a.sequence ?? 0) - (b.sequence ?? 0)

/** The board's columns for these states (of one project or several): one a name and group, in Plane's order. */
export function columnsOf(states: readonly PlaneState[]): PlaneColumn[] {
  const seen = new Set<string>()
  const out: PlaneColumn[] = []
  for (const state of [...states].sort(byOrder)) {
    const key = `${state.name}\u0000${groupOf(state.group)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: state.name, group: groupOf(state.group), color: state.color ?? '' })
  }
  return out
}

/**
 * The state of a project a card dropped in the column `name` (of `group`) goes to: the state of that name, else the
 * first of the group (a column of Notion's has no state of its name in Plane). Null when there is none.
 */
export function pickState(states: readonly PlaneState[], name: string, group: TaskGroup | null): PlaneState | null {
  const byName = states.find((s) => s.name === name)
  if (byName) return byName
  if (!group) return null
  return states.filter((s) => groupOf(s.group) === group).sort(byOrder)[0] ?? null
}

/** The projects to read: those named by identifier, else all. */
export function wantedProjects(all: PlaneProject[], identifiers: readonly string[]): PlaneProject[] {
  const wanted = identifiers.map((i) => i.toLowerCase())
  return wanted.length ? all.filter((p) => wanted.includes(p.identifier.toLowerCase())) : all
}

/** A list typed in a setting: separated by commas, spaces or lines. */
export const listOf = (typed: string): string[] => typed.split(/[\s,;]+/).filter(Boolean)
