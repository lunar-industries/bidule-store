import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Options, SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import type { Environment } from '@bidule/api/extensions'
import type { ClaudePlace } from '../contract.ts'
import { parseWslPath } from './wsl.ts'

/**
 * Taken from quack-board (connectors/claude_runner.ts, Simon's): where Claude Code runs for a folder. It runs where the
 * outside tools run (ctx.env), like git: inside WSL on Windows (the distro's own Claude Code: Linux paths and tools, and
 * the login made there), in the toolbox or on the Flatpak's host on Linux. On this machine itself (and in PowerShell,
 * where Claude Code is installed on Windows), the Claude Code the SDK ships for this system.
 */

// Where a Claude Code that is not this process's runs.
export interface ClaudeRemote {
  // How the environment is named (« WSL (Debian) », « Toolbox (fedora-toolbox-42) »…).
  label: string
  // Absolute path of `claude` there.
  claude: string
}

export interface Place {
  // The session's folder, as Claude Code sees it (a Linux path inside WSL).
  cwd: string
  // Where its sessions are saved, as this process reaches it; undefined: this machine's ~/.claude.
  configDir: string | undefined
  // null: the SDK's own Claude Code, run by this process.
  remote: ClaudeRemote | null
  // What the SDK needs to run that Claude Code.
  options: Pick<Options, 'pathToClaudeCodeExecutable' | 'spawnClaudeCodeProcess'>
}

// `claude` lives in a folder the user's shell adds to PATH (~/.local/bin): asked to their interactive login shell.
// The last line of its output is the answer (an interactive shell may print a banner first).
const LOOKUP = `shell=$(getent passwd "$(id -un)" | cut -d: -f7)
found=$("\${shell:-sh}" -ilc 'command -v claude' </dev/null 2>/dev/null | tail -n 1)
[ -x "$found" ] || found="$HOME/.local/bin/claude"
printf '%s\\n' "$found"
`

const found = new WeakMap<Environment, Promise<string>>()

// The `claude` of an environment other than this process's.
export function claudeIn(env: Environment): Promise<string> {
  let lookup = found.get(env)
  if (!lookup) {
    lookup = env.info().then(async (info) => {
      const out = await env.run({ argv: ['sh', '-s'], stdin: LOOKUP, timeout: 30_000 }).catch(() => '')
      const claude = out.replace(/\r/g, '').trim().split('\n').pop()
      if (!claude) throw new Error(`Claude Code introuvable dans ${info.label}`)
      return claude
    })
    found.set(env, lookup)
    // A failure (WSL stopped, claude not installed yet) is looked up again next time.
    lookup.catch(() => found.delete(env))
  }
  return lookup
}

/**
 * The environment of a session's Claude Code: this process's, without what would change who pays or where it runs.
 * Claude Code refuses to start inside another Claude Code session (the app may be launched from one), and an API key
 * would bill the use instead of the user's subscription.
 */
export function sessionEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith('CLAUDE') || key === 'ANTHROPIC_API_KEY') continue
    out[key] = value
  }
  return out
}

// Only the variables the SDK sets for Claude Code reach another environment: this process's own would mislead it.
const FORWARDED = /^(CLAUDE|ANTHROPIC|MCP_|DISABLE_|ENABLE_|DEBUG)/

export const forwardedEnv = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && FORWARDED.test(entry[0])))

// For the SDK's `spawnClaudeCodeProcess`: the environment's `claude` with the same arguments, in the session's folder (as
// this process reaches it: the environment makes it its own); the SDK talks to it through stdin and stdout, which the
// environment's go-between (wsl.exe, toolbox, flatpak-spawn) relays.
export function spawnIn(env: Environment, claude: string, folder: string) {
  return (options: SpawnOptions): SpawnedProcess => {
    const { file, args, cwd } = env.command({ argv: [claude, ...options.args], cwd: folder, env: forwardedEnv(options.env) })
    return spawn(file, args, {
      cwd,
      // stderr is not read: left piped, a chatty Claude Code would fill it and block.
      stdio: ['pipe', 'pipe', 'ignore'],
      signal: options.signal,
      windowsHide: true,
    })
  }
}

// Where a folder's Claude Code runs and keeps its sessions.
export async function placeOf(
  folder: string,
  env: Environment,
  lookup: (env: Environment) => Promise<string> = claudeIn
): Promise<Place> {
  const info = await env.info()
  // Here (or in PowerShell): the SDK's own Claude Code, in the folder as it is.
  if (info.kind === 'local' || info.kind === 'powershell') return { cwd: folder, configDir: undefined, remote: null, options: {} }
  if (info.problem) throw new Error(info.problem)
  if (info.kind === 'wsl' && !parseWslPath(folder)) throw new Error(`Les outils tournent dans WSL, les dépôts doivent être dans WSL : ${folder}`)
  const claude = await lookup(env)
  return {
    cwd: env.toEnv(folder),
    configDir: join(info.home, '.claude'),
    remote: { label: info.label, claude },
    options: { pathToClaudeCodeExecutable: claude, spawnClaudeCodeProcess: spawnIn(env, claude, folder) },
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

// The packages that may hold the Claude Code the SDK ships, in the order the SDK tries them.
export function bundledCandidates(platform: NodeJS.Platform, arch: string): string[] {
  const base = '@anthropic-ai/claude-agent-sdk'
  const names = platform === 'linux' ? [`${base}-linux-${arch}`, `${base}-linux-${arch}-musl`] : [`${base}-${platform}-${arch}`]
  return names.map((n) => `${n}/claude${platform === 'win32' ? '.exe' : ''}`)
}

// The Claude Code the SDK runs on this machine, or null when its package is missing.
export function bundledClaude(): string | null {
  const require = createRequire(import.meta.url)
  for (const candidate of bundledCandidates(process.platform, process.arch)) {
    try {
      return require.resolve(candidate)
    } catch {
      // Not installed for this libc or system.
    }
  }
  return null
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

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30_000, windowsHide: true, env: sessionEnv() }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.replace(/\r/g, '').trim())
    )
  })
}

async function statusOf(where: string, ask: (args: string[]) => Promise<string>): Promise<ClaudePlace> {
  try {
    // « 2.1.283 (Claude Code) »
    const version = (await ask(['--version'])).split(' ')[0] || null
    return { where, version, ...parseAuthStatus(await ask(['auth', 'status'])), error: null }
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    return { where, version: null, loggedIn: false, email: null, subscription: null, error }
  }
}

/**
 * The Claude Code the sessions run: the one of the tools' environment (WSL's distro, the toolbox, the Flatpak's host),
 * or the one the SDK ships for this machine. Its version, and whether it is logged in. Nothing is sent to Claude.
 */
export async function detect(env: Environment): Promise<ClaudePlace[]> {
  const info = await env.info()
  if (info.kind === 'local' || info.kind === 'powershell') {
    const local = bundledClaude()
    if (!local) {
      return [{ where: info.label, version: null, loggedIn: false, email: null, subscription: null, error: 'Le Claude Code du SDK manque pour ce système' }]
    }
    return [await statusOf(info.label, (args) => run(local, args))]
  }
  if (info.problem) {
    return [{ where: info.label, version: null, loggedIn: false, email: null, subscription: null, error: info.problem }]
  }
  const claude = await claudeIn(env).catch((err: Error) => err)
  if (claude instanceof Error) {
    return [{ where: info.label, version: null, loggedIn: false, email: null, subscription: null, error: claude.message }]
  }
  return [await statusOf(info.label, (args) => env.run({ argv: [claude, ...args], timeout: 30_000 }).then((out) => out.replace(/\r/g, '').trim()))]
}
