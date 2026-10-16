import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEvent, SessionMessage, SessionStatus } from '../contract.ts'
import { SessionService, type StartInput } from '../server/sessions.ts'
import { mergeListener } from '../server/store.ts'
import { projectFolderName } from '../server/transcript.ts'
import { FakeGit, MemoryStore, fakeEnv, settingsWith, type FakeWatch } from './fakes.ts'

// Taken from quack-board (tests/functional/claude.spec.ts, Simon's): the sessions, run by a fake Claude Code (the SDK
// runs it in place of the real one) that speaks the SDK's protocol and answers by a word of the message.
const FAKE = fileURLToPath(new URL('./fake_claude.mjs', import.meta.url))

// Waits until `done` is true, within a few seconds.
async function until(done: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await done()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('The fake Claude Code did not answer in time')
}

describe('Sessions with a fake Claude Code', () => {
  let repo: string
  let store: MemoryStore
  let service: SessionService
  let told: { sessions: [string, SessionStatus][]; session: [string, SessionMessage][] }

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'lic-claude-'))
    store = new MemoryStore()
    told = { sessions: [], session: [] }
    const git = new FakeGit()
    git.repoList = [{ path: repo, label: 'app' }]
    service = new SessionService({
      env: fakeEnv(),
      store,
      settings: async () => settingsWith({ root: repo }),
      git: async () => git,
      tasks: async () => null,
      tell: {
        sessions: (id, status) => void told.sessions.push([id, status]),
        session: (id, message) => void told.session.push([id, message]),
      },
      executable: FAKE,
    })
  })
  afterEach(async () => {
    for (const row of await store.all()) await service.close(row.id)
  })

  const start = (prompt: string, extra: Partial<StartInput> = {}) => service.start({ repos: [repo], prompt, mode: 'default', ...extra })
  // The lines of a session, once one of them satisfies `wanted`.
  async function lines(id: string, wanted: (e: SessionEvent) => boolean): Promise<SessionEvent[]> {
    let found: SessionEvent[] = []
    await until(async () => {
      found = (await service.eventsOf(id, 0))?.events ?? []
      return found.some(wanted)
    })
    return found
  }
  const asked = async (id: string) => {
    const permission = (await lines(id, (e) => e.kind === 'permission')).find((e) => e.kind === 'permission')
    if (permission?.kind !== 'permission') throw new Error('no permission asked')
    return permission
  }
  // What the fake Claude Code received as the decision: its tool's result.
  const received = async (id: string) => {
    const tool = (await lines(id, (e) => e.kind === 'result')).find((e) => e.kind === 'tool_result')
    if (tool?.kind !== 'tool_result') throw new Error('no tool result')
    const decision: Record<string, unknown> = JSON.parse(tool.text)
    return decision
  }

  it('tells each line in order, the text as it is written, and the state', async () => {
    const id = await start('bonjour')
    await until(() => told.session.some(([, m]) => m.type === 'status' && m.status === 'idle'))
    await service.close(id)

    const own = told.session.filter(([sid]) => sid === id).map(([, m]) => m)
    const seqs = own.flatMap((m) => (m.type === 'event' ? [m.event.seq] : []))
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    const partial = own.findIndex((m) => m.type === 'partial')
    const final = own.findIndex((m) => m.type === 'event' && m.event.kind === 'text' && m.event.text === 'Reçu : bonjour')
    expect(partial).toBeGreaterThan(-1)
    expect(partial).toBeLessThan(final)
    expect(told.sessions.map(([, status]) => status)).toEqual(['running', 'idle', 'saved'])
  })

  it('Claude Code’s own login by default; the module’s API key when the user gave one', async () => {
    const id = await start('bonjour')
    await until(() => service.loginOf(id) !== null)
    expect(service.loginOf(id)).toBe('subscription')
    await service.close(id)

    const keyed = new SessionService({
      env: fakeEnv(),
      store,
      settings: async () => settingsWith({ root: repo }),
      git: async () => Object.assign(new FakeGit(), { repoList: [{ path: repo, label: 'app' }] }),
      tasks: async () => null,
      tell: { sessions: () => {}, session: () => {} },
      executable: FAKE,
      apiKey: async () => 'sk-test',
    })
    const other = await keyed.start({ repos: [repo], prompt: 'bonjour', mode: 'default' })
    await until(() => keyed.loginOf(other) !== null)
    expect(keyed.loginOf(other)).toBe('apiKey')
    await keyed.close(other)
  })

  it('« Toujours » gives Claude Code back the rule it proposed', async () => {
    const id = await start('lance un outil')
    const card = await asked(id)
    expect(card).toMatchObject({ ask: 'tool', canAlways: true, detail: 'ls' })
    service.decide(id, card.id, { allow: true, always: true })
    expect((await received(id)).updatedPermissions).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'session' },
    ])
    const decision = (await lines(id, (e) => e.kind === 'decision')).find((e) => e.kind === 'decision')
    expect(decision).toMatchObject({ allow: true, always: true })
  })

  it('a file edit shows what it replaces', async () => {
    const id = await start('modifie le fichier')
    const tool = (await lines(id, (e) => e.kind === 'tool')).find((e) => e.kind === 'tool')
    expect(tool).toMatchObject({ id: 'tool1', name: 'Edit', change: { file: '/w/app/a.ts', before: 'const a = 1', after: 'const a = 2' } })
  })

  it('Claude’s questions are answered with the labels chosen', async () => {
    const id = await start('une question')
    const card = await asked(id)
    expect(card.ask).toBe('question')
    expect(card.questions[0]?.question).toBe('Quelle base ?')
    service.decide(id, card.id, { allow: true, answers: { 'Quelle base ?': 'launchpad' } })
    expect((await received(id)).updatedInput).toMatchObject({ answers: { 'Quelle base ?': 'launchpad' } })
  })

  it('a question shows each option’s description and preview, and the answer carries the note and the preview chosen', async () => {
    const id = await start('une question')
    const card = await asked(id)
    expect(card.questions[0]?.options).toEqual([
      { label: 'launchpad', description: 'La branche d’intégration', preview: 'git switch launchpad' },
      { label: 'main', description: 'La branche par défaut', preview: null },
    ])
    service.decide(id, card.id, {
      allow: true,
      answers: { 'Quelle base ?': 'launchpad' },
      notes: { 'Quelle base ?': '  la CI y tourne  ' },
    })
    expect((await received(id)).updatedInput).toMatchObject({
      answers: { 'Quelle base ?': 'launchpad' },
      annotations: { 'Quelle base ?': { preview: 'git switch launchpad', notes: 'la CI y tourne' } },
    })
    const decision = (await lines(id, (e) => e.kind === 'decision')).find((e) => e.kind === 'decision')
    expect(decision).toMatchObject({ answer: 'Quelle base ? launchpad · la CI y tourne' })
  })

  it('an answer of the user’s own words carries no annotation it does not need', async () => {
    const id = await start('une question')
    const card = await asked(id)
    service.decide(id, card.id, { allow: true, answers: { 'Quelle base ?': 'une branche à moi' } })
    const input = (await received(id)).updatedInput
    expect(input).toMatchObject({ answers: { 'Quelle base ?': 'une branche à moi' } })
    expect(input).not.toHaveProperty('annotations')
  })

  it('a plan refused goes back with the instruction given', async () => {
    const id = await start('propose un plan')
    const card = await asked(id)
    expect(card).toMatchObject({ ask: 'plan', plan: '1. Lire la tâche\n2. Écrire le code' })
    service.decide(id, card.id, { allow: false, message: 'Commence par les tests' })
    expect(await received(id)).toMatchObject({ behavior: 'deny', message: 'Commence par les tests' })
  })

  it('changes the model, and gives the effort back to its default (null, which Claude Code needs to hear)', async () => {
    const id = await start('bonjour')
    await lines(id, (e) => e.kind === 'result')
    await service.setModel(id, 'haiku')
    await service.setEffort(id, null)
    const all = await lines(id, (e) => e.kind === 'other' && e.text.includes('apply_flag_settings'))
    const requests = all.flatMap((e) => (e.kind === 'other' ? [JSON.parse(e.text)] : []))
    expect(requests).toEqual([
      { subtype: 'set_model', model: 'haiku' },
      { subtype: 'apply_flag_settings', settings: { effortLevel: null } },
    ])
    expect(all.flatMap((e) => (e.kind === 'info' ? [e.text] : []))).toEqual(expect.arrayContaining(['Modèle : haiku', 'Effort : par défaut']))
    await service.settled(id)
    const row = await store.find(id)
    expect([row?.model, row?.effort]).toEqual(['haiku', null])
  })

  it('follows the mode Claude Code changes by itself', async () => {
    const id = await start('accepte tout')
    await lines(id, (e) => e.kind === 'info' && e.text === 'Mode : acceptEdits')
    expect((await service.eventsOf(id, 0))?.mode).toBe('acceptEdits')
    await service.settled(id)
    expect((await store.find(id))?.mode).toBe('acceptEdits')
  })

  it('archives a stopped session, and brings it back once taken up again', async () => {
    const id = await start('bonjour')
    await lines(id, (e) => e.kind === 'result')
    // Running: refused.
    expect(await service.setArchived(id, true)).toBe(false)
    await service.close(id)
    expect(await service.setArchived(id, true)).toBe(true)
    expect((await service.list([repo])).find((s) => s.id === id)?.archived).toBe(true)

    await start('encore', { resume: id })
    expect((await service.list([repo])).find((s) => s.id === id)?.archived).toBe(false)
  })

  it('at the API’s start, the sessions left running are saved', async () => {
    const row = store.fresh({ id: '11111111-1111-4111-8111-111111111111', cwd: repo, taskId: null, repos: [], title: 'Avant la relance', mode: 'default', status: 'waiting' })
    await store.save(row)
    await service.recover()
    expect((await store.find(row.id))?.status).toBe('saved')
  })
})

describe('A task of the core merged into another', () => {
  it('its sessions keep the task left; other merges leave them', async () => {
    const store = new MemoryStore()
    await store.save(store.fresh({ id: 's1', cwd: '/r', taskId: 'old', repos: [], title: 'x', mode: 'default', status: 'saved' }))
    const merged = mergeListener(store)
    await merged({ type: 'branch', from: 'old', into: 'kept' })
    expect((await store.find('s1'))?.taskId).toBe('old')
    await merged({ type: 'task', from: 'old', into: 'kept' })
    expect((await store.find('s1'))?.taskId).toBe('kept')
  })
})

// A session of the terminal (one the app does not run), its transcript written as Claude Code writes it, in a Claude
// Code folder of the test's own (CLAUDE_CONFIG_DIR, which the SDK reads); the environment's notifications are the
// test's to give.
describe('A session of the terminal, followed', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  let config: string
  let repo: string
  let before: string | undefined
  let watches: FakeWatch[]
  let told: [string, SessionMessage][]

  const transcript = (id: string) => join(config, 'projects', projectFolderName(repo), `${id}.jsonl`)
  const line = (id: string, uuid: string, parent: string | null, type: 'user' | 'assistant', text: string) =>
    `${JSON.stringify({
      parentUuid: parent,
      isSidechain: false,
      type,
      message: type === 'user' ? { role: 'user', content: text } : { role: 'assistant', model: 'm', content: [{ type: 'text', text }] },
      uuid,
      timestamp: new Date().toISOString(),
      sessionId: id,
      cwd: repo,
    })}\n`
  const service = (options: { live?: boolean } = {}) =>
    new SessionService({
      env: fakeEnv('local', { watches, live: options.live }),
      store: new MemoryStore(),
      settings: async () => settingsWith({ root: repo }),
      git: async () => new FakeGit(),
      tasks: async () => null,
      tell: { sessions: () => {}, session: (id, message) => void told.push([id, message]) },
    })
  const saidLines = () => told.flatMap(([, m]) => (m.type === 'event' ? [m.event] : []))

  beforeEach(async () => {
    config = await mkdtemp(join(tmpdir(), 'lic-config-'))
    repo = await mkdtemp(join(tmpdir(), 'lic-repo-'))
    before = process.env['CLAUDE_CONFIG_DIR']
    process.env['CLAUDE_CONFIG_DIR'] = config
    watches = []
    told = []
    await mkdir(join(config, 'projects', projectFolderName(repo)), { recursive: true })
    await writeFile(transcript(ID), line(ID, 'a1', null, 'user', 'bonjour'))
  })
  afterEach(() => {
    if (before === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = before
  })

  it('a change of its transcript sends the new lines, and says it is at work', async () => {
    const s = service()
    expect(await s.watch(ID, repo)).toEqual({ live: true })
    expect(watches.map((w) => w.folders)).toEqual([[join(config, 'projects', projectFolderName(repo))]])
    await appendFile(transcript(ID), line(ID, 'a2', 'a1', 'assistant', 'Salut'))
    watches[0].onChange(watches[0].folders[0], `${ID}.jsonl`)
    await until(() => saidLines().length > 0)
    expect(saidLines()).toEqual([{ kind: 'text', text: 'Salut', seq: 2 }])
    expect(told.find(([, m]) => m.type === 'status')?.[1]).toEqual({ type: 'status', status: 'running' })
    s.unwatch(ID)
  })

  it('a change of another file reads nothing', async () => {
    const s = service()
    await s.watch(ID, repo)
    await appendFile(transcript(ID), line(ID, 'a2', 'a1', 'assistant', 'Salut'))
    watches[0].onChange(watches[0].folders[0], 'other.jsonl')
    await new Promise((r) => setTimeout(r, 200))
    expect(told).toEqual([])
    s.unwatch(ID)
  })

  it('a fourth session followed stops the oldest; unwatch stops one', async () => {
    const ids = ['a', 'b', 'c', 'd'].map((c) => `${c.repeat(8)}-1111-4111-8111-111111111111`)
    for (const id of ids) await writeFile(transcript(id), line(id, `${id}-1`, null, 'user', 'bonjour'))
    const s = service()
    for (const id of ids) await s.watch(id, repo)
    expect(watches.map((w) => w.closed)).toEqual([true, false, false, false])
    expect(s.watching).toEqual(ids.slice(1))
    s.unwatch(ids[1])
    expect(watches[1].closed).toBe(true)
    expect(s.watching).toEqual(ids.slice(2))
    for (const id of ids) s.unwatch(id)
  })

  it('not live where the environment cannot follow changes, or without a transcript: nothing is watched', async () => {
    expect(await service({ live: false }).watch(ID, repo)).toEqual({ live: false })
    expect(await service().watch('22222222-2222-4222-8222-222222222222', repo)).toEqual({ live: false })
    expect(watches).toEqual([])
  })
})
