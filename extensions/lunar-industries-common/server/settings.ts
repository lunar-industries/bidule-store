import type { SharedSettings } from '../contract.ts'

// The module's settings (bidule.json), as the other modules get them (contract.ts: SharedSettings).

const K = 'lunar-industries-common'
export const TARGETS = `${K}.targets`

// The two fixed namings; the third, `template`, is the free template of the settings.
const NAMINGS: Record<string, string> = { issue: '{issue}-{slug}', ref: '{ref}-{slug}' }

// A comma-separated setting as a list.
export const list = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

// The repos' own targets, kept as JSON by repo path: what cannot be read is no target.
export function targetsOf(text: unknown): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(String(text || '{}'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string' && Boolean(e[1].trim()))
    )
  } catch {
    return {}
  }
}

// `get`: a setting of the module, as saved or by default.
export async function readShared(get: (key: string) => Promise<unknown>): Promise<SharedSettings> {
  const text = async (key: string) => String((await get(`${K}.${key}`)) ?? '').trim()
  const naming = (await text('naming')) || 'issue'
  return {
    integrationBranches: list(await get(`${K}.integrationBranches`)),
    reviewTarget: (await text('reviewTarget')) || null,
    targets: targetsOf(await get(TARGETS)),
    naming,
    template: NAMINGS[naming] ?? ((await text('template')) || '{ref}-{slug}'),
  }
}

// The repos' own targets with this one's set (null or empty: none of its own), as the setting keeps them.
export function withTarget(targets: Record<string, string>, repo: string, target: string | null): string {
  const own = { ...targets }
  if (target?.trim()) own[repo] = target.trim()
  else delete own[repo]
  return JSON.stringify(own)
}
