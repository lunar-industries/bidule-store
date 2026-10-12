import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { spawn } from 'node:child_process'
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import type { EnvironmentCommand } from '@bidule/api/extensions'
import { describe, expect, it } from 'vitest'
import { claudeIn, claudeOf, detect, forwardedEnv, parseAuthStatus, pathInWsl, placeOf, sessionEnv, spawnIn } from '../server/runner.ts'
import { fakeEnv } from './fakes.ts'

// Taken from quack-board (tests/unit/claude_runner.spec.ts, Simon's), on a fake of the tools' environment.

const CLAUDE = '/home/me/.local/bin/claude'
const claudeIs = async () => CLAUDE
const claudeMissing = async () => {
  throw new Error('Claude Code introuvable')
}

// A spawn that records what it is asked, instead of starting anything.
function recorder() {
  const started: { file: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> }[] = []
  const start = ((file: string, args: string[], options: { cwd?: string; env?: Record<string, string | undefined> }) => {
    started.push({ file, args, cwd: options.cwd, env: options.env })
    return {}
  }) as unknown as typeof spawn
  return { started, start }
}

// What the SDK gives `spawnClaudeCodeProcess`.
const sdkSpawn = (env: Record<string, string | undefined>) =>
  ({ command: CLAUDE, args: ['--output-format', 'stream-json'], env, signal: new AbortController().signal }) as SpawnOptions

describe('Claude runner · where Claude Code runs', () => {
  it('on this machine, the claude its login shell finds runs, in the folder as it is; its sessions are this machine’s', async () => {
    const place = await placeOf('/home/me/app', fakeEnv('local'), claudeIs)
    expect(place).toMatchObject({ cwd: '/home/me/app', configDir: undefined, at: { label: 'Ce poste', claude: CLAUDE, local: true } })
    expect(place.options.pathToClaudeCodeExecutable).toBe(CLAUDE)
    expect(place.options.spawnClaudeCodeProcess).toBeTypeOf('function')
  })

  it('in PowerShell, the claude.exe of Windows, on this machine too', async () => {
    const place = await placeOf('C:\\dev\\app', fakeEnv('powershell'), async () => 'C:\\Users\\me\\.local\\bin\\claude.exe')
    expect(place).toMatchObject({ cwd: 'C:\\dev\\app', configDir: undefined, at: { local: true, claude: 'C:\\Users\\me\\.local\\bin\\claude.exe' } })
  })

  it('in WSL, a repo of the distro runs the distro’s, in its Linux path', async () => {
    const env = fakeEnv('wsl', { home: '\\\\wsl.localhost\\Ubuntu\\home\\me' })
    const place = await placeOf('\\\\wsl.localhost\\Ubuntu\\home\\me\\app', env, claudeIs)
    expect(place.cwd).toBe('/home/me/app')
    // Joined as the platform joins (with backslashes on Windows, where this path is real).
    expect(place.configDir).toBe(join('\\\\wsl.localhost\\Ubuntu\\home\\me', '.claude'))
    expect(place.at).toEqual({ label: 'WSL (Ubuntu)', claude: CLAUDE, local: false })
    expect(place.options.pathToClaudeCodeExecutable).toBe(CLAUDE)
  })

  it('in WSL, a repo on the Windows side is refused', async () => {
    await expect(placeOf('C:\\dev\\app', fakeEnv('wsl'), claudeIs)).rejects.toThrow(/doivent être dans WSL/)
  })

  it('in a toolbox, the toolbox’s Claude Code runs, and keeps its sessions in the home folder it shares', async () => {
    const env = fakeEnv('toolbox', { home: '/home/me' })
    const place = await placeOf('/home/me/app', env, claudeIs)
    expect(place.cwd).toBe('/home/me/app')
    expect(place.configDir).toBe('/home/me/.claude')
    expect(place.at).toEqual({ label: 'Toolbox (fedora)', claude: CLAUDE, local: false })
  })

  it('without Claude Code in the environment, the folder has no place (and the reason is said), on this machine too', async () => {
    for (const kind of ['local', 'powershell', 'toolbox'] as const) {
      await expect(placeOf('/home/me/app', fakeEnv(kind), claudeMissing)).rejects.toThrow(/introuvable/)
    }
  })
})

describe('Claude runner · finding claude', () => {
  it('asks the login shell of the environment, through ctx.env; nothing found is said', async () => {
    const asked: EnvironmentCommand[] = []
    const env = fakeEnv('local', { run: async (c) => (asked.push(c), 'banner\n/home/me/.local/bin/claude\n') })
    expect(await claudeIn(env)).toBe(CLAUDE)
    expect(asked[0].argv).toEqual(['sh', '-s'])
    expect(asked[0].stdin).toContain('command -v claude')
    await expect(claudeIn(fakeEnv('toolbox', { run: async () => '' }))).rejects.toThrow('Claude Code introuvable dans Toolbox (fedora)')
  })

  it('in PowerShell, the claude.exe Get-Command finds; a claude.cmd of npm is refused, with the reason', async () => {
    const asked: EnvironmentCommand[] = []
    const exe = fakeEnv('powershell', { run: async (c) => (asked.push(c), 'C:\\Users\\me\\.local\\bin\\claude.exe\r\n') })
    expect(await claudeIn(exe)).toBe('C:\\Users\\me\\.local\\bin\\claude.exe')
    expect(asked[0].argv[0]).toBe('powershell.exe')
    expect(asked[0].argv.at(-1)).toContain('Get-Command claude -CommandType Application')
    expect(asked[0].argv.at(-1)).toMatch(/^\[Console\]::OutputEncoding=\[Text\.Encoding\]::UTF8;/)
    const npm = fakeEnv('powershell', { run: async () => 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd' })
    await expect(claudeIn(npm)).rejects.toThrow(/installez-le par l’installateur natif/)
  })

  it('in PowerShell, a claude.exe further down the PATH goes before an npm script found first', () => {
    const out = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\nC:\\Users\\Zoé\\.local\\bin\\claude.exe\r\n'
    expect(claudeOf(out, true, 'PowerShell')).toBe('C:\\Users\\Zoé\\.local\\bin\\claude.exe')
    expect(() => claudeOf('C:\\npm\\claude.ps1\r\n', true, 'PowerShell')).toThrow(/installé par npm/)
    expect(() => claudeOf('', true, 'PowerShell')).toThrow('Claude Code introuvable dans PowerShell')
    expect(claudeOf('banner\n/usr/bin/claude\n', false, 'Ce poste')).toBe('/usr/bin/claude')
  })
})

describe('Claude runner · starting it', () => {
  it('on this machine, the claude found is started with the environment the SDK prepared', () => {
    const { started, start } = recorder()
    spawnIn(fakeEnv('local'), 'local', CLAUDE, '/home/me/app', start)(sdkSpawn({ PATH: '/usr/bin', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', GONE: undefined }))
    expect(started).toEqual([
      { file: CLAUDE, args: ['--output-format', 'stream-json'], cwd: '/home/me/app', env: { PATH: '/usr/bin', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' } },
    ])
  })

  it('away from this machine, only the SDK’s variables go, through the go-between', () => {
    const { started, start } = recorder()
    const wsl = fakeEnv('wsl', { distro: 'Ubuntu' })
    spawnIn(wsl, 'wsl', CLAUDE, '\\\\wsl.localhost\\Ubuntu\\home\\me\\app', start)(
      sdkSpawn({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', PATH: 'C:\\Windows', APPDATA: 'C:\\x', DEBUG: '1' })
    )
    expect(started[0].file).toBe('wsl.exe')
    expect(started[0].args).toEqual([
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
    expect(started[0].env).toBeUndefined()
    expect(forwardedEnv({ CLAUDE_X: '1', HOME: '/h', MCP_TIMEOUT: '5', GONE: undefined })).toEqual({ CLAUDE_X: '1', MCP_TIMEOUT: '5' })
  })

  it('the API key never goes on wsl.exe’s command line: WSLENV takes it there', () => {
    const { started, start } = recorder()
    spawnIn(fakeEnv('wsl'), 'wsl', CLAUDE, '\\\\wsl.localhost\\Ubuntu\\home\\me\\app', start)(
      sdkSpawn({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', ANTHROPIC_API_KEY: 'sk-secret' })
    )
    expect(started[0].args.join(' ')).not.toContain('sk-secret')
    expect(started[0].env?.['ANTHROPIC_API_KEY']).toBe('sk-secret')
    expect(started[0].env?.['WSLENV']?.split(':')).toContain('ANTHROPIC_API_KEY')
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
  it('a session’s environment has no Claude Code variable, and no API key but the module’s own', () => {
    const mine = {
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      ANTHROPIC_API_KEY: 'sk-of-the-shell',
      ANTHROPIC_BASE_URL: 'https://proxy',
      HOME: '/home/me',
    }
    expect(sessionEnv('', mine)).toEqual({ PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://proxy', HOME: '/home/me' })
    expect(sessionEnv('sk-of-the-module', mine)).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: 'https://proxy',
      HOME: '/home/me',
      ANTHROPIC_API_KEY: 'sk-of-the-module',
    })
  })

  it('reads the login from `claude auth status`', () => {
    const out = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com', subscriptionType: 'pro' })
    expect(parseAuthStatus(out)).toEqual({ loggedIn: true, email: 'me@example.com', subscription: 'pro' })
    expect(parseAuthStatus('not json')).toEqual({ loggedIn: false, email: null, subscription: null })
  })

  // What claude answers: its version, and its login.
  const answer = (argv: string[]) =>
    argv[1] === '--version' ? '2.1.289 (Claude Code)\n' : JSON.stringify({ loggedIn: true, email: 'me@example.com' })

  it('away from this machine, the status asks the environment’s claude through ctx.env.run', async () => {
    const asked: string[][] = []
    const env = fakeEnv('toolbox', {
      run: async ({ argv }) => {
        asked.push(argv)
        return argv[0] === 'sh' ? `${CLAUDE}\n` : answer(argv)
      },
    })
    expect(await detect(env)).toEqual([
      { where: 'Toolbox (fedora)', version: '2.1.289', loggedIn: true, email: 'me@example.com', subscription: null, apiKey: false, error: null },
    ])
    expect(asked.slice(1)).toEqual([
      [CLAUDE, '--version'],
      [CLAUDE, 'auth', 'status'],
    ])
    const none = await detect(fakeEnv('toolbox', { run: async () => '' }))
    expect(none[0]).toMatchObject({ version: null, apiKey: false, error: 'Claude Code introuvable dans Toolbox (fedora)' })
  })

  it('on this machine, it starts claude with the sessions’ environment: no variable of another Claude Code, the module’s key', async () => {
    const started: { argv: string[]; env?: Record<string, string> }[] = []
    const start = ((file: string, args: string[], options: { env?: Record<string, string> }) => {
      started.push({ argv: [file, ...args], env: options.env })
      const child = Object.assign(new EventEmitter(), { stdout: new Readable({ read() {} }), stderr: new Readable({ read() {} }) })
      // As a process: its output, then its end once the output is read.
      child.stdout.on('end', () => child.emit('close', 0))
      child.stdout.push(answer([file, ...args]))
      child.stdout.push(null)
      return child
    }) as unknown as typeof spawn
    const before = process.env['CLAUDECODE']
    process.env['CLAUDECODE'] = '1'
    try {
      const env = fakeEnv('local', { run: async () => `${CLAUDE}\n` })
      expect(await detect(env, 'sk-of-the-module', start)).toMatchObject([{ version: '2.1.289', loggedIn: true, apiKey: true, error: null }])
    } finally {
      if (before === undefined) delete process.env['CLAUDECODE']
      else process.env['CLAUDECODE'] = before
    }
    expect(started.map((s) => s.argv)).toEqual([
      [CLAUDE, '--version'],
      [CLAUDE, 'auth', 'status'],
    ])
    expect(started[0].env?.['CLAUDECODE']).toBeUndefined()
    expect(started[0].env?.['ANTHROPIC_API_KEY']).toBe('sk-of-the-module')
  })
})
