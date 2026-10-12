// Each Lunar Industries module kept its own copy of the settings now shared here: once installed, the module's
// migration (database/migrations/…_settings_from_modules.ts) takes over what the user had saved in them, so nothing
// they chose is lost when the old keys are no longer declared (the core then ignores them).
//
// Values are those of the settings table: JSON (a text setting is a JSON string; the repos' targets and Claude's
// per-repo settings are a JSON object inside that string).

const C = 'lunar-industries-common'

// Where each shared setting was, in the order their values are taken.
export const OLD_KEYS = {
  integrationBranches: [
    'lunar-industries-branches.hidden',
    'lunar-industries-kanban.hiddenBranches',
    'lunar-industries-temps.integrationBranches',
    'lunar-industries-claude.integrationBranches',
  ],
  reviewTarget: ['lunar-industries-branches.reviewTarget', 'lunar-industries-claude.reviewTarget'],
  naming: ['lunar-industries-branches.naming', 'lunar-industries-claude.branchNaming'],
  template: ['lunar-industries-branches.template', 'lunar-industries-claude.branchTemplate'],
} as const
const BRANCHES_TARGETS = 'lunar-industries-branches.targets'
const CLAUDE_REPOS = 'lunar-industries-claude.repos'

// The integration branches the modules used by default, names of one team included: kept for an install that used
// them without saving the setting anywhere.
export const OLD_INTEGRATION = 'main, master, develop, launchpad, factory, orbit'
const NAMINGS = ['issue', 'ref', 'template']

const parse = (raw: string | undefined): unknown => {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
const textOf = (raw: string | undefined) => {
  const value = parse(raw)
  return typeof value === 'string' ? value : undefined
}
// A JSON object kept in a text setting.
const objectOf = (raw: string | undefined): Record<string, unknown> => {
  const value = parse(textOf(raw))
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

// The names of every saved list, each once whatever its case (the first spelling kept); undefined when none is saved.
function union(stored: Map<string, string>, keys: readonly string[]): string | undefined {
  const lists = keys.map((k) => textOf(stored.get(k))).filter((v) => v !== undefined)
  if (!lists.length) return undefined
  const names = new Map<string, string>()
  for (const name of lists.flatMap((l) => l.split(',').map((n) => n.trim()))) {
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
  }
  return [...names.values()].join(', ')
}

// The first saved value that is not empty, and the place of its key in `keys` (-1 when none).
function firstOf(stored: Map<string, string>, keys: readonly string[], valid: (v: string) => boolean = () => true) {
  const values = keys.map((k) => textOf(stored.get(k))?.trim())
  const at = values.findIndex((v) => v && valid(v))
  return { value: at < 0 ? undefined : values[at], at }
}
const first = (stored: Map<string, string>, keys: readonly string[], valid?: (v: string) => boolean) =>
  firstOf(stored, keys, valid).value

// Each repo's own target: Claude's per-repo settings, then the Branches page's, which wins.
function targets(stored: Map<string, string>): Record<string, string> | undefined {
  const fromClaude = Object.entries(objectOf(stored.get(CLAUDE_REPOS))).flatMap(([repo, own]) => {
    const target = own && typeof own === 'object' ? Reflect.get(own, 'reviewTarget') : undefined
    return typeof target === 'string' && target.trim() ? [[repo, target.trim()]] : []
  })
  const fromBranches = Object.entries(objectOf(stored.get(BRANCHES_TARGETS))).flatMap(([repo, target]) =>
    typeof target === 'string' && target.trim() ? [[repo, target.trim()]] : []
  )
  const all = Object.fromEntries([...fromClaude, ...fromBranches])
  return Object.keys(all).length ? all : undefined
}

/**
 * The shared settings to save, by key, as the table keeps them, from the stored rows of the old keys and of the new
 * ones (`stored`, key → value). A shared setting already saved is left alone. The integration branches are the union
 * of the lists saved in the modules; when none was saved but the modules served before (`used`), the old default they
 * all followed; on a new install, nothing (the shared default applies). The review target and the naming come from
 * the Branches page, else from Claude; the template from the module whose naming was kept (a free template goes with
 * its naming), else from the first that saved one.
 */
export function settingsToKeep(stored: Map<string, string>, used: boolean): Map<string, string> {
  const out = new Map<string, string>()
  const keep = (key: string, value: string | undefined) => {
    if (value !== undefined && !stored.has(`${C}.${key}`)) out.set(`${C}.${key}`, JSON.stringify(value))
  }
  keep('integrationBranches', union(stored, OLD_KEYS.integrationBranches) ?? (used ? OLD_INTEGRATION : undefined))
  keep('reviewTarget', first(stored, OLD_KEYS.reviewTarget))
  const naming = firstOf(stored, OLD_KEYS.naming, (v) => NAMINGS.includes(v))
  keep('naming', naming.value)
  const sameModule = naming.at < 0 ? undefined : first(stored, [OLD_KEYS.template[naming.at]])
  keep('template', sameModule ?? first(stored, OLD_KEYS.template))
  const own = targets(stored)
  keep('targets', own && JSON.stringify(own))
  return out
}
