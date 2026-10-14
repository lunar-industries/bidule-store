import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerContext } from '@bidule/api/extensions'
import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest'
import { TerminalService } from '../server/service.ts'

// The terminal's service with what it reads of the core: the repos and branches (git's objects), a task and its links,
// and the commands it prepares for the tabs. Taken from the official terminal's tests (Japa, in the core), the core's
// objects replaced by these.
type Objects = {
  repositories: { id: string; path: string; label: string }[]
  branches: { id: string; repositoryId: string; name: string; lastCommitAt: string | null }[]
  tasks: { id: string; ref: string | null; title: string; branches: string[] }[]
}

function serviceOn(objects: Objects, prepared: unknown[]) {
  const matches = (item: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => item[key] === value)
  const all = (type: string): Record<string, unknown>[] =>
    type === 'repository' ? objects.repositories : type === 'branch' ? objects.branches : type === 'task' ? objects.tasks : []
  return new TerminalService({
    objects: {
      providers: (type: string) => (type === 'repository' || type === 'branch' ? ['git'] : []),
      list: async (type: string, options: { where?: Record<string, unknown>; ids?: string[] } = {}) =>
        all(type).filter((item) => matches(item, options.where) && (!options.ids || options.ids.includes(item.id as string))),
      get: async (type: string, id: string) => {
        const found = all(type).find((item) => item.id === id)
        if (!found) throw new Error(`${type} ${id} inconnu`)
        return found
      },
      related: async (id: string) =>
        (objects.tasks.find((t) => t.id === id)?.branches ?? []).map((branch) => ({ id: branch, outgoing: true })),
      // git is not there: a branch's shell opens in its repo, not a worktree.
      client: () => ({
        worktrees: async () => {
          throw new Error('git absent')
        },
      }),
      first: async () => null,
    },
    terminal: {
      prepare: (launch: unknown) => {
        prepared.push(launch)
        return 'session'
      },
    },
  } as unknown as ServerContext)
}

describe('Terminal (Lunar Industries) · from the core', () => {
  const objects: Objects = {
    repositories: [
      { id: 'r1', path: '/app', label: 'app' },
      { id: 'r2', path: '/lib', label: 'lib' },
    ],
    branches: [
      { id: 'b1', repositoryId: 'r2', name: 'feat/tsk-1-old', lastCommitAt: '2026-10-01T10:00:00Z' },
      { id: 'b2', repositoryId: 'r1', name: 'feat/tsk-1-new', lastCommitAt: '2026-10-10T10:00:00Z' },
    ],
    tasks: [
      { id: 't1', ref: 'TSK-1', title: 'Un titre', branches: ['b1', 'b2'] },
      { id: 't2', ref: 'TSK-2', title: 'Sans branche', branches: [] },
    ],
  }

  it("opens a task's shell in the repo of its latest branch, named after the task", async () => {
    const prepared: { cwd: string }[] = []
    const terminal = serviceOn(objects, prepared)
    expect(await terminal.taskShell('t1')).toEqual({ session: 'session', title: 'TSK-1', folder: '/app' })
    expect(prepared[0].cwd).toBe('/app')
    await expect(terminal.taskShell('t2')).rejects.toThrow(/pas encore de branche/)
  })

  it('finds the deepest known repo of a folder, and refuses a branch the core does not know', async () => {
    const terminal = serviceOn(objects, [])
    expect(await terminal.repoOf('/lib/src')).toEqual({ path: '/lib', label: 'lib' })
    expect(await terminal.repoOf('/elsewhere')).toBeNull()
    expect(await terminal.branchShell('/app', 'feat/tsk-1-new')).toMatchObject({ session: 'session', title: 'feat/tsk-1-new', folder: '/app' })
    await expect(terminal.branchShell('/app', 'nope')).rejects.toThrow(/Branche inconnue/)
  })
})

// A repo's bidule.scripts.json read by the terminal's service: the choices from its files, never one outside it, and a
// launch checked against the file before its argv is prepared.
const SCRIPTS = {
  scripts: [
    {
      name: 'up',
      title: 'Lancer des projets',
      command: ['./dev.sh', 'up', '{projects}', '{extra}'],
      params: {
        projects: {
          label: 'Projets',
          type: 'choice',
          multiple: true,
          required: true,
          choices: { files: 'compose/*.yml', strip: '.yml', exclude: ['base'] },
        },
        extra: { label: 'Arguments', type: 'args' },
      },
    },
    { name: 'gone', command: ['./missing.sh'] },
  ],
}

describe('Terminal (Lunar Industries) · bidule.scripts.json', () => {
  let dir: string
  let repo: string
  let prepared: unknown[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lterm-scripts-'))
    repo = join(dir, 'repo')
    mkdirSync(join(repo, 'compose'), { recursive: true })
    writeFileSync(join(repo, 'dev.sh'), '#!/bin/sh\n', { mode: 0o755 })
    for (const name of ['api', 'web', 'base']) writeFileSync(join(repo, 'compose', `${name}.yml`), '')
    // A file outside the repo, reached by a link from inside it: never offered.
    writeFileSync(join(dir, 'secret.yml'), '')
    symlinkSync(join(dir, 'secret.yml'), join(repo, 'compose', 'secret.yml'))
    writeFileSync(join(repo, 'bidule.scripts.json'), JSON.stringify(SCRIPTS))
    prepared = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // The repos are the core's (git's): one here.
  const service = () => serviceOn({ repositories: [{ id: 'r1', path: repo, label: 'repo' }], branches: [], tasks: [] }, prepared)

  it('offers the files a choice names, inside the repo only', async () => {
    const file = await service().scriptsFile(repo)
    assert.isNull(file?.error)
    const up = file?.scripts.find((s) => s.name === 'up')
    assert.deepEqual(up?.choices, { projects: ['api', 'web'] })
    assert.isNull(up?.problem)
    assert.match(file?.scripts.find((s) => s.name === 'gone')?.problem ?? '', /introuvable/)
  })

  it('prepares the argv built from the values, each one argument', async () => {
    const res = await service().runFile(repo, 'up', { projects: ['web', 'api'], extra: '--build "a b"' })
    assert.equal(res.title, 'Lancer des projets')
    assert.deepEqual(prepared, [{ argv: ['./dev.sh', 'up', 'api', 'web', '--build', 'a b'], cwd: repo, wsl: null, loginShell: true }])
  })

  it('refuses a choice the file does not give, a file outside the repo, a missing program', async () => {
    await expect(service().runFile(repo, 'up', { projects: ['secret'] })).rejects.toThrow(/n'est pas un choix possible/)
    await expect(service().runFile(repo, 'up', { projects: ['../secret'] })).rejects.toThrow(/n'est pas un choix possible/)
    await expect(service().runFile(repo, 'up', { projects: [] })).rejects.toThrow(/au moins une valeur/)
    await expect(service().runFile(repo, 'gone', {})).rejects.toThrow(/introuvable/)
    await expect(service().runFile(repo, 'nope', {})).rejects.toThrow(/n'est pas un script/)
    await expect(service().runFile(dir, 'up', { projects: ['api'] })).rejects.toThrow(/Dépôt inconnu/)
    assert.deepEqual(prepared, [])
  })

  it('an invalid file is an error, refused at launch', async () => {
    writeFileSync(
      join(repo, 'bidule.scripts.json'),
      JSON.stringify({ scripts: [{ name: 'x', command: ['./dev.sh', '--name={n}'], params: { n: { label: 'N', type: 'text' } } }] }),
    )
    const file = await service().scriptsFile(repo)
    assert.match(file?.error ?? '', /argument entier/)
    await expect(service().runFile(repo, 'x', { n: 'a' })).rejects.toThrow(/argument entier/)
    // A pattern leaving the repo is refused as the file is read.
    writeFileSync(
      join(repo, 'bidule.scripts.json'),
      JSON.stringify({
        scripts: [{ name: 'x', command: ['ls', '{c}'], params: { c: { label: 'C', type: 'choice', choices: { files: '../*.yml' } } } }],
      }),
    )
    const refused = await service().scriptsFile(repo)
    assert.match(refused?.error ?? '', /choices\.files/)
  })

  it('lists the scripts of the folder’s repo only, none outside a repo', async () => {
    const inside = await service().scripts(join(repo, 'compose'))
    assert.equal(inside.repo?.path, repo)
    const outside = await service().scripts(dir)
    assert.isNull(outside.repo)
    assert.deepEqual(outside.scripts, [])
    assert.deepEqual(
      outside.repos.map((r) => r.path),
      [repo],
    )
    const asked = await service().scripts(undefined, repo)
    assert.equal(asked.repo?.path, repo)
  })
})
