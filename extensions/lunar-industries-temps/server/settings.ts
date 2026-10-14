import type { ServerContext } from '@bidule/api/extensions'

// The module's settings (bidule.json), read together, with the integration branches of lunar-industries-common.
export type TempsSettings = {
  // ISO numbers, 1 = Monday.
  workDays: Set<number>
  integrationBranches: string[]
  deployBranches: string[]
  defaultLabel: string
  absentLabel: string
  deployLabel: string
  // How the Time Log says a task it cannot relate an entry to (a task of Plane in Notion): a model, see fillTaskText.
  taskText: string
}

const K = 'lunar-industries-temps'

/**
 * The text of a task, from the model of `taskText`: `{url}`, `{ref}` and `{titre}` become the task's address,
 * reference and title in the tool that owns it (empty when it has none); the rest is written as it is.
 */
export function fillTaskText(model: string, task: { title: string; ref: string | null; url: string | null }) {
  const values: Record<string, string> = { url: task.url ?? '', ref: task.ref ?? '', titre: task.title }
  return model.replace(/\{(url|ref|titre)\}/g, (_, name: string) => values[name]).trim()
}

export const list = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

// Out-of-range values are left out; an empty list expects no day at all.
export const workDaysOf = (value: unknown) =>
  new Set(
    list(value)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  )

// The module's own, by default.
export const DEFAULT_SETTINGS: Omit<TempsSettings, 'integrationBranches'> = {
  workDays: new Set([1, 2, 3, 4, 5]),
  deployBranches: [],
  defaultLabel: 'Développement',
  absentLabel: 'Absent',
  deployLabel: 'Déploiement',
  taskText: '{url}',
}

// The production branches were `launchpad, orbit` by default, names of one team. An install that already used the
// module without setting them keeps that value (database/migrations/…_keep_deploy_branches.ts); a new one has none.
// The value to save, as the settings table keeps it (JSON), or null.
export const OLD_DEPLOY_BRANCHES = 'launchpad, orbit'

export function deployBranchesToKeep(stored: string | undefined, used: boolean): string | null {
  return stored === undefined && used ? JSON.stringify(OLD_DEPLOY_BRANCHES) : null
}

export async function readSettings(ctx: ServerContext): Promise<TempsSettings> {
  const get = (key: string) => ctx.settings.get(`${K}.${key}`)
  const text = async (key: keyof TempsSettings, fallback: string) => String((await get(key)) ?? '').trim() || fallback
  const work = await get('workDays')
  return {
    workDays: work === undefined ? DEFAULT_SETTINGS.workDays : workDaysOf(work),
    integrationBranches: (await ctx.commands.execute('lunar-industries-common.settings', undefined)).integrationBranches,
    deployBranches: list((await get('deployBranches')) ?? DEFAULT_SETTINGS.deployBranches.join(', ')),
    defaultLabel: await text('defaultLabel', DEFAULT_SETTINGS.defaultLabel),
    absentLabel: await text('absentLabel', DEFAULT_SETTINGS.absentLabel),
    deployLabel: await text('deployLabel', DEFAULT_SETTINGS.deployLabel),
    taskText: await text('taskText', DEFAULT_SETTINGS.taskText),
  }
}
