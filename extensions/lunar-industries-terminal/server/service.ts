import { glob, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { ServerContext } from '@bidule/api/extensions'
import type { TerminalLaunch } from '@bidule/api/bridge'
import type { GitSource } from '@bidule/ext-git/contract'
import type { ForgeClient } from '@bidule/sdk/forges'
import { parseWslPath } from '@bidule/sdk/paths'
import {
  justRecipes,
  makeTargets,
  packageRunner,
  packageScripts,
  scriptArgv,
  type Runner,
  type Script,
} from '../scripts.ts'
import {
  buildArgv,
  choicesOfFiles,
  listedChoices,
  parseScriptsFile,
  SCRIPTS_FILE,
  SCRIPTS_FILE_MAX,
  shownArgv,
  type FileScript,
  type ScriptValues,
} from '../scripts-file.ts'
import { TerminalError } from './errors.ts'

// A script of the repo's bidule.scripts.json as the interface gets it: with its choices resolved, and why it cannot run
// (its program missing) if so.
export type FileScriptView = FileScript & { choices: Record<string, string[]>; problem: string | null }
export type ScriptsFileView = { error: string | null; scripts: FileScriptView[] }

// Whether `path` is `root` or inside it.
const within = (root: string, path: string) => {
  const r = relative(root, path)
  return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r))
}

type Repo = { path: string; label: string }

const trim = (p: string) => p.replace(/[\\/]+$/, '')
const inside = (folder: string, path: string) => {
  const [f, p] = [trim(folder), trim(path)]
  return p === f || p.startsWith(`${f}/`) || p.startsWith(`${f}\\`)
}

// The interactive login shell of the user, there (getent where it exists, else $SHELL).
const LOGIN_SHELL = 's=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7); exec "${s:-${SHELL:-/bin/sh}}" -l'

// The user's shell in a folder (PowerShell on Windows without WSL): started by the core as a tab's own, with the shell
// integration (`shell`); the argv is for a core that does not know `shell`.
function userShell(place: Pick<TerminalLaunch, 'wsl'>): Pick<TerminalLaunch, 'argv' | 'shell'> {
  if (process.platform === 'win32' && !place.wsl) return { argv: ['powershell.exe', '-NoLogo'], shell: true }
  return { argv: ['sh', '-c', LOGIN_SHELL], shell: true }
}

/**
 * What the terminal reads of the other roles: the repo a tab's folder is in (git), what it can run (its package.json
 * scripts, Makefile targets, justfile recipes), the address of one of its reviews (its forge), a task's folder.
 */
export class TerminalService {
  constructor(protected ctx: ServerContext) {}

  // git itself, for what only it reads live (a branch's worktree).
  #git() {
    return this.ctx.objects.client<GitSource>('git')
  }

  // The user's repos, as the core has them (git's); `ordered`: the most recently committed to first, then by label.
  async #repos(ordered = false): Promise<Repo[]> {
    if (!this.ctx.objects.providers('repository').length) throw new TerminalError("Aucun dépôt git : l'extension git n'est pas là", 404)
    const repos = await this.ctx.objects.list('repository')
    if (!ordered) return repos.map((r) => ({ path: r.path, label: r.label }))
    const latest = new Map<string, string>()
    for (const b of await this.ctx.objects.list('branch')) {
      if (b.lastCommitAt && b.lastCommitAt > (latest.get(b.repositoryId) ?? '')) latest.set(b.repositoryId, b.lastCommitAt)
    }
    return repos
      .sort((a, b) => (latest.get(b.id) ?? '').localeCompare(latest.get(a.id) ?? '') || a.label.localeCompare(b.label))
      .map((r) => ({ path: r.path, label: r.label }))
  }

  // The known repo a folder is in (as the tab's shell says it: a Linux path in WSL), the deepest one.
  async repoOf(folder: string): Promise<Repo | null> {
    const repos = await this.#repos()
    const found = repos.filter((r) => inside(r.path, folder) || inside(parseWslPath(r.path)?.linux ?? '\0', folder))
    return found.sort((a, b) => b.path.length - a.path.length)[0] ?? null
  }

  // The repo asked for (a known one), else the tab's (its folder's); none outside a repo, never another one in its place.
  async #repo(folder: string | undefined, asked: string | undefined): Promise<Repo | null> {
    if (asked) return (await this.#repos()).find((r) => r.path === asked) ?? null
    return folder ? await this.repoOf(folder) : null
  }

  // A worktree of the repo the branch is checked out in, else the repo itself (git not there: the repo).
  async #folderOf(repo: string, branch: string): Promise<string> {
    try {
      return (await this.#git().worktrees(repo)).find((w) => w.branch === branch)?.path ?? repo
    } catch {
      return repo
    }
  }

  // A repo's scripts (its package.json, Makefile, justfile; its bidule.scripts.json apart), and the other known repos.
  async scripts(
    folder?: string,
    asked?: string,
  ): Promise<{ repo: Repo | null; scripts: Script[]; file: ScriptsFileView | null; repos: Repo[] }> {
    const repos = await this.#repos(true)
    const repo = await this.#repo(folder, asked)
    if (!repo) return { repo: null, scripts: [], file: null, repos }
    return { repo, scripts: await this.#scriptsIn(repo.path), file: await this.scriptsFile(repo.path), repos }
  }

  // The repo's bidule.scripts.json, read and checked; null without one.
  async scriptsFile(repoPath: string): Promise<ScriptsFileView | null> {
    const path = join(repoPath, SCRIPTS_FILE)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) return null
    if (info.size > SCRIPTS_FILE_MAX) return { error: `${SCRIPTS_FILE} dépasse ${SCRIPTS_FILE_MAX / 1024} Ko`, scripts: [] }
    const { scripts, error } = parseScriptsFile(await readFile(path, 'utf8'))
    if (error) return { error, scripts: [] }
    const root = await realpath(repoPath)
    const views: FileScriptView[] = []
    for (const script of scripts) {
      const choices = { ...listedChoices(script) }
      for (const key of script.order) {
        const from = script.params[key].choices
        if (from && !Array.isArray(from)) choices[key] = choicesOfFiles(await this.#filesIn(root, from.files), from)
      }
      views.push({ ...script, choices, problem: await this.#programProblem(root, script) })
    }
    return { error: null, scripts: views }
  }

  // The files a pattern matches in the repo, never one outside it (a link pointing away is left out).
  async #filesIn(root: string, pattern: string): Promise<string[]> {
    const out: string[] = []
    for await (const found of glob(pattern, { cwd: root })) {
      const real = await realpath(join(root, found)).catch(() => null)
      if (real && within(root, real) && (await stat(real)).isFile()) out.push(found)
      if (out.length >= 500) break
    }
    return out
  }

  // A program given by its path in the repo must be a file there.
  async #programProblem(root: string, script: FileScript): Promise<string | null> {
    const program = script.command[0]
    if (!program.startsWith('./')) return null
    const real = await realpath(join(root, program)).catch(() => null)
    if (!real || !within(root, real) || !(await stat(real)).isFile()) return `${program} est introuvable dans le dépôt`
    return null
  }

  /**
   * A script of the repo's bidule.scripts.json, in a new tab: the file read again, the values checked against it (its
   * choices, its required parameters), the argv built here and run without a shell reading it (the login shell only
   * `exec`s it, each element one argument).
   */
  async runFile(repoPath: string, name: string, values: ScriptValues) {
    const repo = (await this.#repos()).find((r) => r.path === repoPath)
    if (!repo) throw new TerminalError('Dépôt inconnu', 404)
    const file = await this.scriptsFile(repo.path)
    if (!file) throw new TerminalError(`${repo.label} n'a pas de ${SCRIPTS_FILE}`, 404)
    if (file.error) throw new TerminalError(file.error, 422)
    const script = file.scripts.find((s) => s.name === name)
    if (!script) throw new TerminalError(`« ${name} » n'est pas un script de ${SCRIPTS_FILE}`, 404)
    if (script.problem) throw new TerminalError(script.problem, 422)
    let argv: string[]
    try {
      argv = buildArgv(script, values, script.choices)
    } catch (err) {
      throw new TerminalError((err as Error).message, 422)
    }
    const place = this.#place(repo.path)
    // Windows without WSL runs a command through cmd.exe, which would read its arguments again.
    if (process.platform === 'win32' && !place.wsl) throw new TerminalError(`Les scripts de ${SCRIPTS_FILE} tournent dans WSL`, 422)
    const session = this.ctx.terminal.prepare({ argv, ...place, loginShell: true })
    return { session, title: script.title, folder: repo.path, command: shownArgv(argv) }
  }

  async #scriptsIn(path: string): Promise<Script[]> {
    const files = await readdir(path).catch((): string[] => [])
    const read = (name: string) => readFile(join(path, name), 'utf8').catch(() => '')
    const out: Script[] = []
    if (files.includes('package.json')) out.push(...packageScripts(await read('package.json'), packageRunner(files)))
    const makefile = ['GNUmakefile', 'makefile', 'Makefile'].find((f) => files.includes(f))
    if (makefile) out.push(...makeTargets(await read(makefile)))
    const justfile = ['justfile', 'Justfile', '.justfile'].find((f) => files.includes(f))
    if (justfile) out.push(...justRecipes(await read(justfile)))
    return out
  }

  // Where a launch runs: inside its WSL distribution for a repo there.
  #place(path: string): Pick<TerminalLaunch, 'cwd' | 'wsl'> {
    const wsl = parseWslPath(path)
    return wsl ? { cwd: wsl.linux, wsl: wsl.distro } : { cwd: path, wsl: null }
  }

  // A script of a known repo, in a new tab: only one its files list, through the user's login shell (their tools).
  async run(repoPath: string, runner: Runner, name: string) {
    const repo = (await this.#repos()).find((r) => r.path === repoPath)
    if (!repo) throw new TerminalError('Dépôt inconnu', 404)
    const script = (await this.#scriptsIn(repo.path)).find((s) => s.runner === runner && s.name === name)
    if (!script) throw new TerminalError(`${runner} ${name} n'est pas un script de ${repo.label}`, 404)
    const argv = scriptArgv(script)
    const session = this.ctx.terminal.prepare({ argv, ...this.#place(repo.path), loginShell: true })
    return { session, title: argv.join(' '), folder: repo.path }
  }

  // The address of review `number` of a tab's repo (`mr` on GitLab, `pr` on GitHub), when its forge is known.
  async reviewUrl(folder: string, kind: 'mr' | 'pr', number: number): Promise<string | null> {
    const repo = await this.repoOf(folder)
    if (!repo) return null
    const client = await forgeOf(this.ctx, repo.path)
    if (!client || (kind === 'mr') !== (client.kind === 'gitlab')) return null
    return client.reviewUrl?.(number) ?? null
  }

  /**
   * A shell on a branch (Git's page): the worktree it is checked out in, else its repo. Only a branch the core knows.
   */
  async branchShell(repo: string, name: string) {
    const [known] = await this.ctx.objects.list('repository', { where: { path: repo } })
    const [branch] = known ? await this.ctx.objects.list('branch', { where: { repositoryId: known.id, name } }) : []
    if (!known || !branch) throw new TerminalError('Branche inconnue', 404)
    const folder = await this.#folderOf(known.path, name)
    const place = this.#place(folder)
    const session = this.ctx.terminal.prepare({ ...userShell(place), ...place })
    return { session, title: name, folder }
  }

  /**
   * A shell where a task is worked on: the worktree its latest branch is checked out in (the Claude tab's), else that
   * branch's repo. The tab takes the task's reference.
   */
  async taskShell(taskId: string) {
    // The task's branches: the core's links `task → branch`.
    const ids = (await this.ctx.objects.related(taskId, { kind: 'branch', type: 'branch' }))
      .filter((l) => l.outgoing)
      .map((l) => l.id)
    const branches = ids.length ? await this.ctx.objects.list('branch', { ids }) : []
    const [branch] = branches.sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''))
    const repo = branch ? await this.ctx.objects.get('repository', branch.repositoryId) : null
    if (!branch || !repo) throw new TerminalError("Cette tâche n'a pas encore de branche", 404)
    const folder = await this.#folderOf(repo.path, branch.name)
    const task = await this.ctx.objects.get('task', taskId).catch(() => null)
    const place = this.#place(folder)
    const session = this.ctx.terminal.prepare({ ...userShell(place), ...place })
    return { session, title: task?.ref ?? task?.title ?? branch.name, folder }
  }
}

// The forge serving a repo (by its path), as a client on its project: null without one, or without its token.
export async function forgeOf(ctx: ServerContext, path: string): Promise<ForgeClient | null> {
  const [repo] = await ctx.objects.list('repository', { where: { path } })
  return repo ? ctx.objects.first('review.forge', { repositoryId: repo.id }) : null
}
