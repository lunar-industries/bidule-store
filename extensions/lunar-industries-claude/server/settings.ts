import type { ServerContext } from '@bidule/api/extensions'
import type { RepoOverrides } from '../contract.ts'

// The module's settings (bidule.json), read together: what the sessions and the tools need.
export type Settings = {
  enabled: boolean
  root: string
  settingSources: string[]
  defaultMode: string
  defaultModel: string
  defaultEffort: string
  // The suite's (Branches module): the review target of every repo, and of each one in particular.
  reviewTarget: string
  repoTargets: Record<string, string>
  branchNaming: string
  branchTemplate: string
  createIssue: boolean
  integrationBranches: string[]
  deploy: {
    stagingBranch: string
    productionBranch: string
    stagingJob: string
    productionJob: string
    stagingEnvs: string[]
    stagingEnv: string
    testStatus: string
  }
  repos: Record<string, RepoOverrides>
}

const K = 'lunar-industries-claude'

// A comma-separated setting as a list.
export const list = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

// What the suite's modules share is the Branches module's (Réglages › Lunar Industries - Branches): the integration
// branches, the review target, the naming of the branches, the issue created at the start, the checkout. Without that
// module, these defaults.
const BRANCHES = 'lunar-industries-branches'
const DEFAULT_INTEGRATION = 'main, master, develop, launchpad, factory, orbit'

export async function readSettings(ctx: ServerContext): Promise<Settings> {
  const get = async (key: string) => ctx.settings.get(`${K}.${key}`)
  const text = async (key: string) => String((await get(key)) ?? '').trim()
  const shared = async (key: string) => ctx.settings.get(`${BRANCHES}.${key}`)
  const sharedText = async (key: string) => String((await shared(key)) ?? '').trim()
  let repos: Record<string, RepoOverrides> = {}
  try {
    const parsed: Record<string, RepoOverrides> | null = JSON.parse((await text('repos')) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) repos = parsed
  } catch {
    // Unreadable: no repo has settings of its own.
  }
  // Each repo's review target, as the Branches page keeps them.
  let repoTargets: Record<string, string> = {}
  try {
    const parsed: Record<string, string> | null = JSON.parse((await sharedText('targets')) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) repoTargets = parsed
  } catch {
    // Unreadable: no repo has a target of its own.
  }
  return {
    enabled: (await get('enabled')) === true,
    root: await text('root'),
    settingSources: list(await get('settingSources')),
    defaultMode: (await text('defaultMode')) || 'default',
    defaultModel: await text('defaultModel'),
    defaultEffort: await text('defaultEffort'),
    reviewTarget: await sharedText('reviewTarget'),
    repoTargets,
    branchNaming: (await sharedText('naming')) || 'issue',
    branchTemplate: (await sharedText('template')) || '{ref}-{slug}',
    createIssue: (await sharedText('createIssue')) === '1',
    integrationBranches: list((await shared('hidden')) ?? DEFAULT_INTEGRATION),
    deploy: {
      stagingBranch: await text('stagingBranch'),
      productionBranch: await text('productionBranch'),
      stagingJob: await text('stagingJob'),
      productionJob: await text('productionJob'),
      stagingEnvs: list(await get('stagingEnvs')),
      stagingEnv: await text('stagingEnv'),
      testStatus: await text('testStatus'),
    },
    repos,
  }
}

// What a repo overrides of the module's settings (empty: nothing).
export const overridesOf = (s: Settings, repo: string): RepoOverrides => s.repos[repo] ?? {}

// The branch a repo's reviews go to: the one chosen for it on the Branches page, else the suite's; null when nobody said.
export const reviewTargetOf = (s: Settings, repo: string) => s.repoTargets[repo]?.trim() || s.reviewTarget || null

// Taken from quack-board (domain/deploy.ts): how a repo is deployed, its own values else the module's; null: nobody
// said (the skills ask).
export function deployOf(s: Settings, repo: string) {
  const own = overridesOf(s, repo)
  const pick = (mine: string | undefined, app: string) => mine?.trim() || app.trim() || null
  return {
    stagingBranch: pick(own.stagingBranch, s.deploy.stagingBranch),
    productionBranch: pick(own.productionBranch, s.deploy.productionBranch),
    stagingJob: pick(own.stagingJob, s.deploy.stagingJob),
    productionJob: pick(own.productionJob, s.deploy.productionJob),
    stagingEnvs: s.deploy.stagingEnvs,
    stagingEnv: pick(own.stagingEnv, s.deploy.stagingEnv),
    testStatus: s.deploy.testStatus || null,
  }
}

// ---------- branch names (taken from quack-board, domain/branch_links.ts)

// The two fixed namings; the third, 'template', is the free template of the settings.
const NAMINGS: Record<string, string> = { issue: '{issue}-{slug}', ref: '{ref}-{slug}' }
export const templateOf = (s: Settings) => NAMINGS[s.branchNaming] ?? s.branchTemplate

const SLUG_MAX = 60

// A task title as a branch name part: lower case, no accents, words joined by dashes, cut between words.
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= SLUG_MAX) return slug
  const cut = slug.slice(0, SLUG_MAX + 1).lastIndexOf('-')
  return slug.slice(0, cut > 0 ? cut : SLUG_MAX)
}

// The name the template gives a branch: {issue} its issue number, {ref} the task's reference in lower case.
export function branchName(template: string, parts: { issue?: number | string | null; ref?: string | null; slug: string }): string {
  return template
    .replaceAll('{issue}', String(parts.issue ?? ''))
    .replaceAll('{ref}', (parts.ref ?? '').toLowerCase())
    .replaceAll('{slug}', parts.slug)
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PARTS: Record<string, string> = { '{issue}': '(\\d+)', '{ref}': '[a-z0-9]+(?:[-_]?\\d+)?', '{slug}': '.+' }

// The issue number a branch name carries, when the naming has one: 488-fix-login → 488.
export function issueOf(template: string, name: string): number | null {
  if (!template.includes('{issue}')) return null
  const pattern = template
    .split(/(\{issue\}|\{ref\}|\{slug\})/)
    .map((part) => PARTS[part] ?? escapeRegExp(part))
    .join('')
  const found = new RegExp(`^${pattern}$`).exec(name)
  return found?.[1] ? Number(found[1]) : null
}
