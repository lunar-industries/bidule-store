import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundledCandidates, forwardedEnv, parseAuthStatus, pathInWsl, placeOf, sessionEnv, spawnIn } from '../server/runner.ts'
import { fakeEnv } from './fakes.ts'

// Taken from quack-board (tests/unit/claude_runner.spec.ts, Simon's), on a fake of the tools' environment.

const CLAUDE = '/home/me/.local/bin/claude'
const claudeIs = async () => CLAUDE
const claudeMissing = async () => {
  throw new Error('Claude Code introuvable')
}

describe('Claude runner · where Claude Code runs', () => {
  it('on this machine, a folder runs the SDK’s own Claude Code', async () => {
    const place = await placeOf('/home/me/app', fakeEnv('local'), claudeMissing)
    expect(place).toEqual({ cwd: '/home/me/app', configDir: undefined, remote: null, options: {} })
  })

  it('in PowerShell, too: the Claude Code installed on Windows is the SDK’s', async () => {
    const place = await placeOf('C:\\dev\\app', fakeEnv('powershell'), claudeMissing)
    expect(place).toEqual({ cwd: 'C:\\dev\\app', configDir: undefined, remote: null, options: {} })
  })

  it('in WSL, a repo of the distro runs the distro’s, in its Linux path', async () => {
    const env = fakeEnv('wsl', { home: '\\\\wsl.localhost\\Ubuntu\\home\\me' })
    const place = await placeOf('\\\\wsl.localhost\\Ubuntu\\home\\me\\app', env, claudeIs)
    expect(place.cwd).toBe('/home/me/app')
    // Joined as the platform joins (with backslashes on Windows, where this path is real).
    expect(place.configDir).toBe(join('\\\\wsl.localhost\\Ubuntu\\home\\me', '.claude'))
    expect(place.remote).toEqual({ label: 'WSL (Ubuntu)', claude: CLAUDE })
    expect(place.options.pathToClaudeCodeExecutable).toBe(CLAUDE)
    expect(place.options.spawnClaudeCodeProcess).toBeTypeOf('function')
  })

  it('in WSL, a repo on the Windows side is refused', async () => {
    await expect(placeOf('C:\\dev\\app', fakeEnv('wsl'), claudeIs)).rejects.toThrow(/doivent être dans WSL/)
  })

  it('in a toolbox, the toolbox’s Claude Code runs, and keeps its sessions in the home folder it shares', async () => {
    const env = fakeEnv('toolbox', { home: '/home/me' })
    const place = await placeOf('/home/me/app', env, claudeIs)
    expect(place.cwd).toBe('/home/me/app')
    expect(place.configDir).toBe('/home/me/.claude')
    expect(place.remote).toEqual({ label: 'Toolbox (fedora)', claude: CLAUDE })
  })

  it('without Claude Code in the environment, the folder has no place (and the reason is said)', async () => {
    await expect(placeOf('/home/me/app', fakeEnv('toolbox'), claudeMissing)).rejects.toThrow(/introuvable/)
  })

  it('the environment starts the claude it found, with the SDK’s arguments and its variables only', () => {
    const wsl = fakeEnv('wsl', { distro: 'Ubuntu' })
    const command = wsl.command({
      argv: [CLAUDE, '--output-format', 'stream-json'],
      cwd: '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
      env: forwardedEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', PATH: 'C:\\Windows', APPDATA: 'C:\\x', DEBUG: '1' }),
    })
    expect(command.file).toBe('wsl.exe')
    expect(command.args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/me/app',
      '-e',
      'env',
      'CLAUDE_CODE_ENTRYPOINT=sdk-ts',
      'DEBUG=1',
      CLAUDE,
      '--output-format',
      'stream-json',
    ])
    expect(spawnIn(wsl, CLAUDE, '\\\\wsl.localhost\\Ubuntu\\home\\me\\app')).toBeTypeOf('function')
  })
})

describe('Claude runner · paths inside WSL', () => {
  it('a Windows path goes under /mnt, a folder of the distro keeps its Linux path', () => {
    expect(pathInWsl('C:\\Program Files\\Bidule\\resources\\plugin')).toBe('/mnt/c/Program Files/Bidule/resources/plugin')
    expect(pathInWsl('\\\\wsl.localhost\\Ubuntu\\home\\me\\plugin')).toBe('/home/me/plugin')
    expect(pathInWsl('/home/me/plugin')).toBe('/home/me/plugin')
  })
})

describe('Claude runner · environment and detection', () => {
  it('a session’s environment has no Claude Code variable and no API key', () => {
    const env = sessionEnv({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      ANTHROPIC_API_KEY: 'sk-x',
      ANTHROPIC_BASE_URL: 'https://proxy',
      HOME: '/home/me',
    })
    expect(env).toEqual({ PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://proxy', HOME: '/home/me' })
  })

  it('the SDK’s Claude Code is looked for in the package of the system', () => {
    expect(bundledCandidates('linux', 'x64')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    ])
    expect(bundledCandidates('darwin', 'arm64')).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'])
  })

  it('reads the login from `claude auth status`', () => {
    const out = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com', subscriptionType: 'pro' })
    expect(parseAuthStatus(out)).toEqual({ loggedIn: true, email: 'me@example.com', subscription: 'pro' })
    expect(parseAuthStatus('not json')).toEqual({ loggedIn: false, email: null, subscription: null })
  })
})
