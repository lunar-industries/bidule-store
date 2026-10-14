import { describe, expect, it } from 'vitest'
import { justRecipes, makeTargets, packageRunner, packageScripts, scriptArgv } from '../scripts.ts'

describe("Terminal (Lunar Industries) · a repo's scripts", () => {
  it('reads package.json scripts with the package manager of the lockfile', () => {
    expect(packageRunner(['package.json', 'pnpm-lock.yaml'])).toBe('pnpm')
    expect(packageRunner(['package.json', 'yarn.lock'])).toBe('yarn')
    expect(packageRunner(['package.json', 'bun.lock'])).toBe('bun')
    expect(packageRunner(['package.json', 'package-lock.json'])).toBe('npm')
    const scripts = packageScripts('{"scripts":{"test":"vitest","dev:web":"vite","bad name":"x","n":3}}', 'pnpm')
    expect(scripts.map((s) => scriptArgv(s).join(' '))).toEqual(['pnpm run test', 'pnpm run dev:web'])
    expect(packageScripts('not json', 'npm')).toEqual([])
  })

  it('reads the explicit targets of a Makefile', () => {
    const text = '.PHONY: build test\nCC := gcc\nbuild: main.o\n\t$(CC) -o app\n%.o: %.c\ntest:\nbuild: other\nX ::= 1\n'
    expect(makeTargets(text).map((s) => s.name)).toEqual(['build', 'test'])
  })

  it("reads a justfile's recipes, their comment as description", () => {
    const text = 'set shell := ["bash", "-c"]\nversion := "1"\nalias b := build\n# Builds it all\nbuild target="all":\n  echo {{target}}\n@quiet:\n  true\n'
    expect(justRecipes(text)).toEqual([
      { runner: 'just', name: 'build', detail: 'Builds it all' },
      { runner: 'just', name: 'quiet', detail: '' },
    ])
    expect(scriptArgv({ runner: 'make', name: 'build' })).toEqual(['make', 'build'])
  })
})
