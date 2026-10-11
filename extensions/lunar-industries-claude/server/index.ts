import { fileURLToPath } from 'node:url'
import type { ServerContext } from '@bidule/api/extensions'
import type { GitSource } from '@bidule/ext-git/contract'
import '../contract.ts'
import { SessionError } from './errors.ts'
import { forgeOf, taskAccess } from './objects.ts'
import { list, readSettings, reviewTargetOf } from './settings.ts'
import { SessionService } from './sessions.ts'
import { SessionStore } from './store.ts'
import { workspaceTools } from './tools.ts'
import { addWorktree, baseOf, shellVia } from './worktrees.ts'

// For the controller, once started (its page's first request starts it).
export let ctx: ServerContext
export let store: SessionStore
export let sessions: SessionService

// The team's skills, loaded by every session (a Claude Code plugin, copied with the module).
export const PLUGIN = fileURLToPath(new URL('../claude/plugin', import.meta.url))

export const settings = () => readSettings(ctx)
// git's actions (the repos, their branches, git itself), through the core.
export const git = async () => ctx.objects.client<GitSource>('git')
// The core's tasks; null without any provider of them.
export const tasks = async () => taskAccess(ctx)
// The forge serving a repo, by its path (`review.forge`: GitHub, GitLab).
export const forge = (repo: string) => forgeOf(ctx, repo)

// The sessions run only once the user has turned them on (Réglages): the Agent SDK with their Claude account.
export async function enabled(): Promise<void> {
  if (!(await settings()).enabled) {
    throw new SessionError('Les sessions Claude dans l’app sont désactivées (Réglages › Lunar Industries - Claude)', 403)
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
    tools: workspaceTools({ env: ctx.env, git, tasks, forgeOf: forge, settings, store }),
    worktree: repoWorktree,
    plugins: [PLUGIN],
  })
  // No process survived the previous API: the sessions it ran are saved.
  await sessions.recover()
}
