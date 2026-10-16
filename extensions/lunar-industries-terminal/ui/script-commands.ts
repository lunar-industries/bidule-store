import { navigate, openPalette, react, registerCommands, type Command, type PaletteScope } from '@bidule/sdk'
import { scriptArgv, type Script } from '../scripts.ts'
import { SCRIPTS_FILE, shownArgv, type FileScript, type ScriptValues } from '../scripts-file.ts'
import { PAGE } from './page.ts'
import { startFileScript } from './ScriptDialog.tsx'
import type { TerminalTabs } from './tabs.ts'

// A script of the repo's `bidule.scripts.json`: its choices from files resolved by the server, and why it cannot run.
export type FileScriptView = FileScript & { choices: Record<string, string[]>; problem: string | null }
// The file: absent (null), unreadable (error), or its scripts.
export type ScriptsFileView = { error: string | null; scripts: FileScriptView[] }

export type Listed = {
  repo: { path: string; label: string } | null
  scripts: Script[]
  file?: ScriptsFileView | null
  repos?: { path: string; label: string }[]
}

// A repo's scripts are read again after this long (a package.json just edited shows within the minute).
const FRESH_MS = 60_000

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`)
  return body
}

/**
 * The scripts of the active tab's repo (its folder's, else the latest repo with activity) in the command palette:
 * « npm run test », « make build »… each in a new tab, kept once it ends so its output can be read.
 */
// A script in a new tab, kept once it ends so its output can be read.
export async function runScript(terminals: TerminalTabs, repo: string, script: Script): Promise<void> {
  try {
    const { session, title, folder } = await json<{ session: string; title: string; folder: string }>('/api/ext/lunar-industries-terminal/scripts/run', {
      method: 'POST',
      body: JSON.stringify({ repo, runner: script.runner, name: script.name }),
    })
    navigate(PAGE)
    await terminals.add({ session }, title, folder, { keep: true })
  } catch (err) {
    const message = (err as Error).message
    react('panic', message, message)
  }
}

// A script of `bidule.scripts.json` with the values given, in a new tab kept once it ends. The server builds the argv.
export async function runFileScript(terminals: TerminalTabs, repo: string, name: string, values: ScriptValues): Promise<boolean> {
  try {
    const { session, title, folder } = await json<{ session: string; title: string; folder: string }>('/api/ext/lunar-industries-terminal/scripts/run', {
      method: 'POST',
      body: JSON.stringify({ repo, source: 'file', name, values }),
    })
    navigate(PAGE)
    await terminals.add({ session }, title, folder, { keep: true })
    return true
  } catch (err) {
    const message = (err as Error).message
    react('panic', message, message)
    return false
  }
}

const cache = new Map<string, { at: number; listed: Listed }>()

// The scripts of a repo (`repo`), else of the repo a folder is in (none outside a repo), and the known repos; read
// again after FRESH_MS.
export async function scriptsOf(place: string, repo?: string): Promise<Listed> {
  const key = `${place}\n${repo ?? ''}`
  const entry = cache.get(key)
  if (entry && Date.now() - entry.at <= FRESH_MS) return entry.listed
  const params = new URLSearchParams({ ...(place ? { cwd: place } : {}), ...(repo ? { repo } : {}) })
  const query = params.size ? `?${params}` : ''
  const listed = await json<Listed>(`/api/ext/lunar-industries-terminal/scripts${query}`).catch((): Listed => ({ repo: null, scripts: [] }))
  cache.set(key, { at: Date.now(), listed })
  return listed
}

type Repo = { path: string; label: string }

// The palette's scopes: « Scripts » lists the known repos, « Scripts › <repo> » a repo's scripts.
const ROOT: PaletteScope = { label: 'Scripts', group: 'Scripts' }
const repoScope = (repo: Repo): PaletteScope => ({ label: repo.label, group: `Scripts · ${repo.label}`, parent: ROOT })

// The repo of the active tab, once read (null outside a repo).
let tabRepo: Repo | null = null

// The palette's scope on the Terminal's page: the active tab's repo's scripts, else the list of the repos.
export const scriptsScope = (): PaletteScope => (tabRepo ? repoScope(tabRepo) : ROOT)

// Why the palette has no script to offer: a line that says it, and says it again when chosen.
const NONE_IN_REPO = 'Ni package.json, ni composer.json, ni Makefile, ni bidule.scripts.json n’y déclare de script.'
const NO_REPO = 'Ce terminal n’est dans aucun dépôt, et git n’en a lu aucun : ouvre un terminal dans un dépôt pour voir ses scripts.'
const empty = (id: string, title: string, group: string, why: string): Command => ({
  id,
  title,
  group,
  detail: why,
  run: () => react('quack', why, why),
})

// A file or a script that cannot run is not left out silently: a line of the repo's scripts that says why when chosen.
const problem = (id: string, title: string, group: string, message: string): Command => ({
  id,
  title,
  group,
  detail: message,
  run: () => react('panic', message, message),
})

// A repo's scripts as commands of its scope: those of its bidule.scripts.json first, then its files'.
function commandsOf(terminals: TerminalTabs, repo: Repo, { scripts, file }: Listed): Command[] {
  const { group } = repoScope(repo)
  const id = (rest: string) => `terminal.script:${repo.path}:${rest}`
  const commands: Command[] = []
  if (file?.error) commands.push(problem(id('file-error'), `${SCRIPTS_FILE} à corriger`, group, file.error))
  for (const s of file?.scripts ?? []) {
    if (s.problem) {
      commands.push(problem(id(`file:${s.name}`), `${s.title} (à corriger)`, group, s.problem))
      continue
    }
    commands.push({
      id: id(`file:${s.name}`),
      // « … »: a form asks its parameters first.
      title: `${s.title}${s.order.length ? '…' : ''}`,
      group,
      detail: s.description || shownArgv(s.command),
      run: () => startFileScript(terminals, repo, s),
    })
  }
  for (const s of scripts) {
    commands.push({
      id: id(`${s.runner}:${s.name}`),
      title: scriptArgv(s).join(' '),
      group,
      detail: s.detail || undefined,
      run: () => runScript(terminals, repo.path, s),
    })
  }
  return commands
}

/**
 * The scripts in the palette: under « Scripts », the known repos (the active tab's first); under each repo, its scripts.
 * The active tab's repo's are always there; another repo's once chosen in the list, which reopens the palette on them.
 */
export function syncScripts(terminals: TerminalTabs): void {
  let shown = ''
  let unregister: () => void = () => undefined
  let unregisterPicked: () => void = () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null

  const pick = async (repo: Repo) => {
    // The active tab's repo has its scripts already: registered again, they would go with the other repo's.
    if (repo.path !== tabRepo?.path) {
      const listed = await scriptsOf('', repo.path)
      unregisterPicked()
      unregisterPicked = registerCommands(...commandsOf(terminals, repo, listed))
    }
    openPalette(repoScope(repo))
  }

  const refresh = async () => {
    const listed = await scriptsOf(terminals.active?.place ?? '')
    const { repo } = listed
    tabRepo = repo
    const key = JSON.stringify(listed)
    if (key === shown) return
    shown = key
    unregister()
    const repos = [...(repo ? [repo] : []), ...(listed.repos ?? []).filter((r) => r.path !== repo?.path)]
    const commands: Command[] = repos.map((r) => ({
      id: `terminal.scripts-of:${r.path}`,
      title: r.label,
      group: ROOT.group,
      detail: r.path,
      run: () => pick(r),
    }))
    if (repo) {
      const own = commandsOf(terminals, repo, listed)
      commands.push(...own)
      // A repo without a script: the palette says why it is empty instead of showing nothing.
      if (!own.length) commands.push(empty(`terminal.scripts-none:${repo.path}`, `Aucun script dans ${repo.label}`, repoScope(repo).group, NONE_IN_REPO))
    }
    if (!repos.length) commands.push(empty('terminal.scripts-none', 'Aucun dépôt connu', ROOT.group, NO_REPO))
    unregister = registerCommands(...commands)
  }

  // At most once in a while: the tabs change often (titles, output marks).
  const soon = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void refresh()
    }, 500)
  }
  terminals.subscribe(soon)
  soon()
}
