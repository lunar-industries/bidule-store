import { fileURLToPath } from 'node:url'
import type { ServerContext } from '@bidule/api/extensions'
import type { GitSource } from '@bidule/ext-git/contract'
import '../contract.ts'
import { SessionError } from './errors.ts'
import { branchAccess, forgeOf, refreshForge, taskAccess } from './objects.ts'
import { PipelineChanges } from './pipeline_changes.ts'
import { list, readSettings, reviewTargetOf } from './settings.ts'
import { SessionService } from './sessions.ts'
import { mergeListener, SessionStore } from './store.ts'
import { workspaceTools } from './tools.ts'
import { addWorktree, baseOf, shellVia } from './worktrees.ts'

// For the controller, once started (its page's first request starts it).
export let ctx: ServerContext
export let store: SessionStore
export let sessions: SessionService

// The team's skills, loaded by every session (a Claude Code plugin, copied with the module).
export const PLUGIN = fileURLToPath(new URL('../claude/plugin', import.meta.url))

export const settings = () => readSettings(ctx)
// The user's Anthropic API key (Réglages, kept in the system's keychain); empty: Claude Code's own login.
export const apiKey = () => ctx.secrets.get('lunar-industries-claude.apiKey')
// git's actions (the repos, git itself, its worktrees), through the core.
export const git = async () => ctx.objects.client<GitSource>('git')
// The core's branches: a task's, with their review and CI; a branch's task, and linking one by hand. Through
// lunar-industries-common (a dependency), as the review targets, the naming and the integration branches (settings).
export const branches = () =>
  branchAccess({
    branches: (filter) => ctx.commands.execute('lunar-industries-common.branches', filter),
    link: (args) => ctx.commands.execute('lunar-industries-common.link', args),
  })
// The core's tasks; null without any provider of them.
export const tasks = async () => taskAccess(ctx)
// The forge serving a repo, by its path (`review.forge`: GitHub, GitLab).
export const forge = (repo: string) => forgeOf(ctx, repo)
// That forge reading a branch again after a write there (`review.refresh`).
export const refreshBranch = (repo: string, branch: string) => refreshForge(ctx, repo, branch)

// The sessions run only once the user has turned them on (Réglages): the Agent SDK with their Claude account.
export async function enabled(): Promise<void> {
  if (!(await settings()).enabled) {
    throw new SessionError('Les sessions Claude dans l’app sont désactivées (Réglages › Claude)', 403)
  }
}

// A branch's worktree in a repo, with the repo's settings: its base, the untracked files to copy, its preparation.
export async function repoWorktree(repo: string, branch: string) {
  const s = await settings()
  const g = await git()
  const own = s.repos[repo] ?? {}
  return addWorktree(g, repo, branch, {
    base: await baseOf(g, repo, reviewTargetOf(s, repo)),
    seed: list((own.worktreeSeed ?? '').replace(/\s+/g, ',')),
    prepare: own.worktreePrepare || null,
    shell: shellVia(ctx.env),
  })
}

export async function activate(context: ServerContext) {
  ctx = context
  store = new SessionStore(ctx.db)
  // The pipelines the forges read again, as the core announces them: what wait_pipeline waits on.
  const pipelines = new PipelineChanges()
  ctx.events.on('objects.changed', ({ type }) => pipelines.changed(type))
  sessions = new SessionService({
    env: ctx.env,
    store,
    settings,
    git,
    tasks,
    tell: {
      sessions: (id, status) => void ctx.events.emit('lunar-industries-claude.sessions', { id, status }),
      session: (id, message) => void ctx.events.emit('lunar-industries-claude.session', { id, message }),
    },
    tools: workspaceTools({ env: ctx.env, git, branches, tasks, forgeOf: forge, refreshForge: refreshBranch, pipelines, settings, store }),
    worktree: repoWorktree,
    plugins: [PLUGIN],
    apiKey,
  })
  // No process survived the previous API: the sessions it ran are saved.
  await sessions.recover()
  ctx.events.on('objects.merged', mergeListener(store))
}
