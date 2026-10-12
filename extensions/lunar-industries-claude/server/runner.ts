import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { Options, SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import type { Environment, EnvironmentKind } from '@bidule/api/extensions'
import type { ClaudePlace } from '../contract.ts'
import { parseWslPath } from './wsl.ts'

/**
 * Taken from quack-board (connectors/claude_runner.ts, Simon's): where Claude Code runs for a folder. Bidule ships no
 * tool: Claude Code is the one of the outside tools' environment (ctx.env), like git, found and started through it.
 * Inside WSL on Windows (the distro's own Claude Code: Linux paths and tools, and the login made there), in PowerShell
 * (its claude.exe), in the toolbox or on the Flatpak's host on Linux, and on this machine itself.
 */

// The Claude Code that runs for a folder.
export interface ClaudeAt {
  // How the environment is named (« WSL (Debian) », « Toolbox (fedora-toolbox-42) », « Ce poste »…).
  label: string
  // Absolute path of `claude` there.
  claude: string
  // On this machine (here, or in PowerShell): it sees this process's files and paths.
  local: boolean
}

export interface Place {
  // The session's folder, as Claude Code sees it (a Linux path inside WSL).
  cwd: string
  // Where its sessions are saved, as this process reaches it; undefined: this machine's (~/.claude, or the user's
  // CLAUDE_CONFIG_DIR, which the SDK reads).
  configDir: string | undefined
  at: ClaudeAt
  // What the SDK needs to run that Claude Code.
  options: Pick<Options, 'pathToClaudeCodeExecutable' | 'spawnClaudeCodeProcess'>
}

// `claude` lives in a folder the user's shell adds to PATH (~/.local/bin): asked to their interactive login shell (the
// one of their account, else $SHELL: macOS has no getent). The last line of its output is the answer (an interactive
// shell may print a banner first); nothing when it is not there.
const LOOKUP = `shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)
shell=\${shell:-$SHELL}
found=$("\${shell:-sh}" -ilc 'command -v claude' </dev/null 2>/dev/null | tail -n 1)
[ -x "$found" ] || found="$HOME/.local/bin/claude"
[ -x "$found" ] && printf '%s\\n' "$found"
`
// In PowerShell: every program `claude` names on its PATH, one a line, in UTF-8 (a path may hold accents).
const POWERSHELL = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Command claude -CommandType Application -All -ErrorAction Stop).Source',
]
// Claude Code installed by npm on Windows is a script (claude.cmd, claude.ps1): Node refuses to start one without a
// shell (CVE-2024-27980), and a shell would read the SDK's arguments its own way.
const NPM_ON_WINDOWS = 'Claude Code est installé par npm : installez-le par l’installateur natif (claude.exe)'

/**
 * The `claude` a lookup found, from its answer: the last line of the login shell's (it may print a banner first); in
 * PowerShell, the first claude.exe of the PATH, before any script of npm, which is refused when it is all there is.
 * `label` names the environment in the error.
 */
export function claudeOf(out: string, powershell: boolean, label: string): string {
  const lines = out
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const claude = powershell ? lines.find((l) => /\.exe$/i.test(l)) : lines.at(-1)
  if (claude) return claude
  if (powershell && lines.some((l) => /\.(cmd|bat|ps1)$/i.test(l))) throw new Error(NPM_ON_WINDOWS)
  throw new Error(`Claude Code introuvable dans ${label}`)
}

const found = new WeakMap<Environment, Promise<string>>()

// The `claude` of the tools' environment.
export function claudeIn(env: Environment): Promise<string> {
  let lookup = found.get(env)
  if (!lookup) {
    lookup = env.info().then(async (info) => {
      const powershell = info.kind === 'powershell'
      const ask = powershell ? { argv: POWERSHELL } : { argv: ['sh', '-s'], stdin: LOOKUP }
      const out = await env.run({ ...ask, timeout: 30_000 }).catch(() => '')
      return claudeOf(out, powershell, info.label)
    })
    found.set(env, lookup)
    // A failure (WSL stopped, claude not installed yet) is looked up again next time.
    lookup.catch(() => found.delete(env))
  }
  return lookup
}

const API_KEY = 'ANTHROPIC_API_KEY'

/**
 * The environment of a session's Claude Code: this process's, without what would change who pays or where it runs.
 * Claude Code refuses to start inside another Claude Code session (the app may be launched from one), and an API key
 * of this process would bill the use instead of the user's subscription: only the module's own key (a secret of its
 * settings), when the user gave one, is used.
 */
export function sessionEnv(apiKey = '', env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith('CLAUDE') || key === API_KEY) continue
    out[key] = value
  }
  if (apiKey) out[API_KEY] = apiKey
  return out
}

// Only the variables the SDK sets for Claude Code reach another environment: this process's own would mislead it.
const FORWARDED = /^(CLAUDE|ANTHROPIC|MCP_|DISABLE_|ENABLE_|DEBUG)/

export const forwardedEnv = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && FORWARDED.test(entry[0])))

const definedOnly = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))

/**
 * For the SDK's `spawnClaudeCodeProcess`: the environment's `claude` with the SDK's arguments, in the session's folder (as
 * this process reaches it: the environment makes it its own), started through ctx.env.command; the SDK talks to it
 * through stdin and stdout, which the environment's go-between (wsl.exe, toolbox, flatpak-spawn) relays. On this
 * machine (here, or in PowerShell), the environment the SDK prepared goes with the process, as its own spawn does;
 * elsewhere only the SDK's variables go, through the go-between. The API key, a secret, stays off the command line
 * where it can: wsl.exe takes it from the process's environment (WSLENV); a toolbox and the Flatpak's host only take
 * variables as arguments of their go-between. `start`: node's spawn (another one in the tests).
 */
export function spawnIn(env: Environment, kind: EnvironmentKind, claude: string, folder: string, start: typeof spawn = spawn) {
  const local = kind === 'local' || kind === 'powershell'
  return (options: SpawnOptions): SpawnedProcess => {
    const forwarded = forwardedEnv(options.env)
    const { [API_KEY]: apiKey, ...others } = forwarded
    const viaWslEnv = kind === 'wsl' && apiKey !== undefined
    const there = local ? undefined : viaWslEnv ? others : forwarded
    const { file, args, cwd } = env.command({ argv: [claude, ...options.args], cwd: folder, env: there })
    const here = local
      ? definedOnly(options.env)
      : viaWslEnv
        ? { ...definedOnly(process.env), [API_KEY]: apiKey, WSLENV: [process.env['WSLENV'], API_KEY].filter(Boolean).join(':') }
        : undefined
    return start(file, args, {
      cwd,
      env: here,
      // stderr is not read: left piped, a chatty Claude Code would fill it and block.
      stdio: ['pipe', 'pipe', 'ignore'],
      signal: options.signal,
      windowsHide: true,
    })
  }
}

// Where a folder's Claude Code runs and keeps its sessions; refused, with the reason, when it is not there.
export async function placeOf(
  folder: string,
  env: Environment,
  lookup: (env: Environment) => Promise<string> = claudeIn
): Promise<Place> {
  const info = await env.info()
  if (info.problem) throw new Error(info.problem)
  if (info.kind === 'wsl' && !parseWslPath(folder)) throw new Error(`Les outils tournent dans WSL, les dépôts doivent être dans WSL : ${folder}`)
  const claude = await lookup(env)
  const local = info.kind === 'local' || info.kind === 'powershell'
  return {
    cwd: env.toEnv(folder),
    configDir: local ? undefined : join(info.home, '.claude'),
    at: { label: info.label, claude, local },
    options: { pathToClaudeCodeExecutable: claude, spawnClaudeCodeProcess: spawnIn(env, info.kind, claude, folder) },
  }
}

// A path of this machine as a WSL distro sees it: a Windows drive under /mnt, a folder of the distro by its Linux path.
export function pathInWsl(path: string): string {
  const inWsl = parseWslPath(path)
  if (inWsl) return inWsl.linux
  const drive = path.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!drive) return path
  return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`
}

// What `claude auth status` prints: a JSON object.
export function parseAuthStatus(stdout: string): Pick<ClaudePlace, 'loggedIn' | 'email' | 'subscription'> {
  try {
    const status = JSON.parse(stdout) as { loggedIn?: unknown; email?: unknown; subscriptionType?: unknown }
    return {
      loggedIn: status.loggedIn === true,
      email: typeof status.email === 'string' ? status.email : null,
      subscription: typeof status.subscriptionType === 'string' ? status.subscriptionType : null,
    }
  } catch {
    return { loggedIn: false, email: null, subscription: null }
  }
}

// What a command of the environment prints, started on what it builds with these variables only (`vars`), as a session's
// Claude Code is on this machine; the error says what it wrote on stderr.
function output(env: Environment, argv: string[], vars: Record<string, string>, start: typeof spawn): Promise<string> {
  const { file, args, cwd } = env.command({ argv })
  return new Promise((resolve, reject) => {
    const child = start(file, args, { cwd, env: vars, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000 })
    let out = ''
    let err = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (text: string) => (out += text))
    child.stderr?.on('data', (text: string) => (err += text))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${argv[0]} : code ${code}`))))
  })
}

/**
 * The Claude Code the sessions run: the one of the tools' environment (this machine, PowerShell, WSL's distro, the
 * toolbox, the Flatpak's host). Its version, whether it is logged in, and whether the module has an API key of its own
 * (`apiKey`: the sessions then use it). Asked as the sessions run it: on this machine, with the session's environment
 * (sessionEnv: no variable of another Claude Code, the module's key only); elsewhere through ctx.env.run, whose
 * process gets none of this one's variables. Nothing is sent to Claude. `start`: node's spawn (another in the tests).
 */
export async function detect(env: Environment, apiKey = '', start: typeof spawn = spawn): Promise<ClaudePlace[]> {
  const info = await env.info()
  const keyed = Boolean(apiKey)
  const missing = (error: string): ClaudePlace => ({
    where: info.label,
    version: null,
    loggedIn: false,
    email: null,
    subscription: null,
    apiKey: keyed,
    error,
  })
  if (info.problem) return [missing(info.problem)]
  const claude = await claudeIn(env).catch((err: Error) => err)
  if (claude instanceof Error) return [missing(claude.message)]
  const local = info.kind === 'local' || info.kind === 'powershell'
  const ask = async (args: string[]) =>
    (local
      ? await output(env, [claude, ...args], sessionEnv(apiKey), start)
      : await env.run({ argv: [claude, ...args], timeout: 30_000 })
    )
      .replace(/\r/g, '')
      .trim()
  try {
    // « 2.1.283 (Claude Code) »
    const version = (await ask(['--version'])).split(' ')[0] || null
    return [{ where: info.label, version, ...parseAuthStatus(await ask(['auth', 'status'])), apiKey: keyed, error: null }]
  } catch (err) {
    return [missing((err instanceof Error ? err.message : String(err)).split('\n')[0])]
  }
}
