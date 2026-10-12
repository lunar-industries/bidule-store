// The delay before a task is to be chased up was read from the official Kanban's setting (`kanban.staleDays`), which
// the core no longer gives once that Kanban is turned off. Its value, if the user set one, becomes this module's own,
// once, at its install (database/migrations/…_stale_days_from_kanban.ts).

// The options of both settings (bidule.json).
const OPTIONS = ['3', '5', '7', '10', '14']

// The value to save for this module, as the settings table keeps it (JSON), from the official setting's stored value
// and this module's: null when the module has one already, or when the official one is missing or not an option.
export function staleDaysToKeep(official: string | undefined, own: string | undefined): string | null {
  if (own !== undefined || official === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(official)
  } catch {
    return null
  }
  return typeof value === 'string' && OPTIONS.includes(value) ? official : null
}
