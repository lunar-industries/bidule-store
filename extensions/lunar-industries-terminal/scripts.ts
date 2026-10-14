// What a repo can run, read from its files: its package.json scripts (with the package manager its lockfile names),
// its Makefile targets, its justfile recipes. Pure: the server reads the files, the palette lists the scripts.

export type Runner = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'make' | 'just'
export type Script = { runner: Runner; name: string; detail: string }

export const RUNNERS: Runner[] = ['npm', 'pnpm', 'yarn', 'bun', 'make', 'just']

// A script's name as the files allow it, and nothing a shell would read differently (it is passed as one argument).
export const SCRIPT_NAME = /^[\w:.@/+-]{1,100}$/

// The package manager a repo uses, from its lockfile (npm without one).
export function packageRunner(files: string[]): Runner {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm'
  if (files.includes('yarn.lock')) return 'yarn'
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun'
  return 'npm'
}

export function packageScripts(json: string, runner: Runner): Script[] {
  let scripts: unknown
  try {
    scripts = (JSON.parse(json) as { scripts?: unknown }).scripts
  } catch {
    return []
  }
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return []
  return Object.entries(scripts as Record<string, unknown>)
    .filter(([name, command]) => SCRIPT_NAME.test(name) && typeof command === 'string')
    .map(([name, command]) => ({ runner, name, detail: String(command).slice(0, 200) }))
}

// A Makefile's explicit targets: `name:` at the start of a line, not a variable (`:=`), a pattern (%) or a special
// target (.PHONY…).
export function makeTargets(text: string): Script[] {
  const out: Script[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_.\-/]*)\s*:(?![:=])/.exec(line)
    if (!m || seen.has(m[1]) || !SCRIPT_NAME.test(m[1])) continue
    seen.add(m[1])
    out.push({ runner: 'make', name: m[1], detail: '' })
  }
  return out
}

// A justfile's recipes: `name args…:` at the start of a line (an `@` before hides its echo), not a setting, an alias, an
// export or a variable (`:=`); a comment just above is its description.
export function justRecipes(text: string): Script[] {
  const out: Script[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    const m = /^@?([A-Za-z_][A-Za-z0-9_-]*)(?:\s[^:]*)?:(?![=])/.exec(line)
    if (!m || ['set', 'alias', 'export', 'import', 'mod'].includes(m[1])) return
    const comment = /^#\s?(.*)$/.exec(lines[i - 1] ?? '')
    out.push({ runner: 'just', name: m[1], detail: comment ? comment[1].trim() : '' })
  })
  return out
}

// The command line of a script, as the tab's title says it.
export function scriptArgv(script: Pick<Script, 'runner' | 'name'>): string[] {
  if (script.runner === 'make' || script.runner === 'just') return [script.runner, script.name]
  return [script.runner, 'run', script.name]
}
