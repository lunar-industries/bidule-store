import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { Environment, EnvironmentKind } from '@bidule/api/extensions'
import type { GitSource } from '@bidule/ext-git/contract'
import type { ForgeClient, ForgeIssue, ForgeJob, ForgePipeline, ForgeReview, NewReview } from '@bidule/sdk/forges'
import type { Task, TaskColumn, TaskPage } from '@bidule/sdk/tasks'
import type { Board, BranchAccess, TaskAccess } from '../server/objects.ts'
import type { Settings } from '../server/settings.ts'
import { SessionStore, type SessionRow } from '../server/store.ts'

// The module's settings, by default as a new install has them.
export function settingsWith(patch: Partial<Settings> = {}): Settings {
  return {
    enabled: true,
    root: '',
    settingSources: ['user', 'project', 'local'],
    defaultMode: 'default',
    defaultModel: '',
    defaultEffort: '',
    reviewTarget: null,
    targets: {},
    branchNaming: 'issue',
    branchTemplate: '{issue}-{slug}',
    createIssue: false,
    integrationBranches: ['main', 'master', 'develop'],
    deploy: { stagingBranch: '', productionBranch: '', stagingJob: '', productionJob: '', stagingEnvs: [], stagingEnv: '', testStatus: '' },
    repos: {},
    ...patch,
  }
}

/**
 * git's actions: the repos given, and the forge given for every repo (`review.forge`, see forgeOf).
 * `run` is the command answer: by default it records the commands, answers the refs listed and lets every other
 * command succeed (see recording()); real() runs git for real.
 */
export class FakeGit implements GitSource {
  readonly commands: string[] = []
  forge: ForgeClient | null = null
  repoList: { path: string; label: string }[] = []

  constructor(public run: (folder: string, args: string[], timeout?: number) => Promise<string> = async () => '') {}

  async repos() {
    return this.repoList
  }
  branches = unused
  // The forge serving every repo (the core's `review.forge`).
  forgeOf = async () => this.forge
  async resolvePath(path: string) {
    return path === '~' ? homedir() : path
  }
  sync = async () => {}
  events = unused
  status = unused
  createBranch = unused
  remoteBranches = unused
  switchBranch = unused
  defaultBranch = unused
  recordCheckout = unused
  worktrees = unused
  addWorktree = unused
  removeWorktree = unused
}

async function unused(): Promise<never> {
  throw new Error('not used by the module')
}

/**
 * The core's branches: each task's (`ofTask`, by task id), each branch's task (`taskOf`, by `<repo> <name>`); the links
 * made by hand are recorded in `linked` (see objects.test.ts for the real one over the core's objects).
 */
export class FakeBranches implements BranchAccess {
  readonly linked: string[] = []
  ofTasks: Record<string, Awaited<ReturnType<BranchAccess['ofTask']>>> = {}
  tasks: Record<string, string> = {}

  async ofTask(taskId: string) {
    return this.ofTasks[taskId] ?? []
  }
  async taskOf(repo: string, name: string) {
    return this.tasks[`${repo} ${name}`] ?? null
  }
  async link(repo: string, name: string, taskId: string) {
    this.linked.push(`${repo} ${name} ${taskId}`)
    this.tasks[`${repo} ${name}`] = taskId
    return true
  }
}

// Records `<folder> <args>`; the refs listed exist, `rev-parse` answers a sha (or the exclude file's path), every
// other command succeeds.
export function recording(git: FakeGit, refs: string[] = [], answers: { ahead?: string; list?: string; branch?: string } = {}) {
  return async (folder: string, args: string[]) => {
    git.commands.push(`${folder} ${args.join(' ')}`)
    const last = args.at(-1) ?? ''
    if (args[0] === 'show-ref' && !refs.includes(last)) throw new Error('no ref')
    if (args[0] === 'rev-parse' && args[1] === '--git-path') return '.git/info/exclude\n'
    if (args[0] === 'rev-parse') return 'pushed1\n'
    if (args[0] === 'rev-list') return answers.ahead ?? '0\n'
    if (args[0] === 'worktree' && args[1] === 'list') return answers.list ?? ''
    if (args[0] === 'branch' && args[1] === '--show-current') return answers.branch ?? 'launchpad\n'
    return ''
  }
}

// git itself, in the folder given.
export function real(folder: string, args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd: folder, timeout }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  )
}

// A forge answering from maps keyed by branch name and commit sha; a branch missing from the reviews fails like an
// unreachable project. Writes are recorded in `writes`, and a created review is returned by the next reads.
export class FakeForge implements ForgeClient {
  kind: 'gitlab' | 'github' = 'gitlab'
  readonly name = 'GitLab'
  readonly project = 'team/app'
  readonly writes: string[] = []
  issues: Record<number, ForgeIssue> = {}

  constructor(
    protected reviews: Record<string, ForgeReview | null> = {},
    protected pipelines: Record<string, ForgePipeline | null> = {},
    protected pipelineJobs: ForgeJob[] = []
  ) {}

  async review(branch: string) {
    if (!(branch in this.reviews)) throw new Error('404')
    return this.reviews[branch]
  }
  async pipeline(sha: string) {
    return this.pipelines[sha] ?? null
  }
  async jobs() {
    return this.pipelineJobs
  }
  async issue(n: number) {
    return this.issues[n] ?? null
  }
  async runPipeline(branch: string) {
    this.writes.push(`run ${this.project} ${branch}`)
  }
  async retryPipeline(id: number) {
    this.writes.push(`retry ${this.project} ${id}`)
  }
  async playJob(id: number) {
    this.writes.push(`play ${this.project} ${id}`)
  }
  async createReview(review: NewReview) {
    this.writes.push(`review ${this.project} ${review.source} → ${review.target} « ${review.title} »`)
    const created: ForgeReview = { number: 1, state: 'open', draft: review.draft, url: 'https://gl/mr/1', description: review.description }
    this.reviews[review.source] = created
    return created
  }
  async markReady(n: number) {
    this.writes.push(`ready ${this.project} ${n}`)
    for (const r of Object.values(this.reviews)) if (r?.number === n) r.draft = false
  }
  async mergeReview(n: number) {
    this.writes.push(`merge ${this.project} ${n}`)
    for (const r of Object.values(this.reviews)) if (r?.number === n) r.state = 'merged'
  }
  async createIssue(issue: { title: string; description: string }) {
    const n = 500 + this.writes.filter((w) => w.startsWith('issue')).length
    this.writes.push(`issue ${this.project} #${n} « ${issue.title} »`)
    const created: ForgeIssue = { number: n, state: 'open', url: `https://gl/issues/${n}`, description: issue.description }
    this.issues[n] = created
    return created
  }
  async createBranch(name: string, from: string) {
    this.writes.push(`branch ${this.project} ${name} from ${from}`)
  }
}

export const COLUMNS: TaskColumn[] = [
  { name: 'Pas commencé', group: 'todo', color: 'neutral' },
  { name: 'En cours', group: 'doing', color: 'blue' },
]

// The core's tasks: one task to do, ID-7; moves and comments recorded.
export class FakeTasks implements TaskAccess {
  readonly moved: string[] = []
  readonly comments: string[] = []
  page: (id: string) => Promise<TaskPage> = async () => ({
    text: '# Contexte\n- ajouter le rôle',
    comments: [{ at: '2026-09-25T10:00:00Z', text: 'Vu avec le PO' }],
  })
  board_: Board = {
    source: 'notion',
    configured: true,
    columns: COLUMNS,
    tasks: [
      {
        id: 't1',
        type: 'task',
        provider: 'notion',
        title: 'Ajout rôle',
        status: 'Pas commencé',
        group: 'todo',
        ref: 'ID-7',
        url: 'https://notion/t1',
        role: 'owner',
        lastEdited: null,
        due: null,
        properties: {},
      },
    ],
  }

  async board() {
    return this.board_
  }
  async get(id: string): Promise<Task | null> {
    return this.board_.tasks.find((t) => t.id === id) ?? null
  }
  async find(key: string): Promise<Task | null> {
    const wanted = key.trim().toLowerCase()
    return this.board_.tasks.find((t) => t.id === key.trim() || t.ref?.toLowerCase() === wanted) ?? null
  }
  async search(): Promise<Task[]> {
    return []
  }
  async move(id: string, status: string) {
    this.moved.push(`${id} ${status}`)
    const task = this.board_.tasks.find((t) => t.id === id)
    if (task) task.status = status
  }
  async comment(id: string, text: string) {
    this.comments.push(`${id} ${text}`)
  }
}

// The sessions' rows, in memory.
export class MemoryStore extends SessionStore {
  rows = new Map<string, SessionRow>()
  archives = new Set<string>()

  constructor() {
    super(null as never)
  }
  override async find(id: string) {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : null
  }
  override async all() {
    return [...this.rows.values()].map((r) => structuredClone(r))
  }
  override async save(row: SessionRow) {
    row.updatedAt = new Date().toISOString()
    this.rows.set(row.id, structuredClone(row))
  }
  override async followTask(from: string, into: string) {
    for (const r of this.rows.values()) if (r.taskId === from) r.taskId = into
  }
  override async recover() {
    for (const r of this.rows.values()) r.status = 'saved'
  }
  override async archived() {
    return new Set(this.archives)
  }
  override async archive(id: string, archived: boolean) {
    if (archived) this.archives.add(id)
    else this.archives.delete(id)
  }
}

// A watch of the fake environment: its folders, its listener, and whether it was closed.
export type FakeWatch = { folders: string[]; onChange: (folder: string, name: string) => void; closed: boolean }

/**
 * The tools' environment (ctx.env), as far as the module uses it. `run` runs the command on this machine, in its folder
 * (a fake of the environment's, which would run it inside WSL, a toolbox or on the host); `command` builds it as WSL's
 * go-between does (wsl.exe) when the kind says so. `watch` keeps each watch in `watches`: a test says a change by
 * calling its `onChange`.
 */
export function fakeEnv(
  kind: EnvironmentKind = 'local',
  options: { home?: string; distro?: string; run?: Environment['run']; live?: boolean; watches?: FakeWatch[] } = {}
): Environment {
  const home = options.home ?? homedir()
  const distro = options.distro ?? 'Ubuntu'
  const watches = options.watches ?? []
  const toEnv = (path: string) => (kind === 'wsl' ? (path.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i)?.[1] ?? '/').replace(/\\/g, '/') : path)
  const env = {
    info: async () => ({
      kind,
      label: kind === 'wsl' ? `WSL (${distro})` : kind === 'toolbox' ? 'Toolbox (fedora)' : 'Ce poste',
      distro: kind === 'wsl' ? distro : null,
      toolbox: kind === 'toolbox' ? 'fedora' : null,
      home,
      problem: null,
      live: options.live ?? true,
    }),
    watch: (folders: string[], onChange: (folder: string, name: string) => void) => {
      const w: FakeWatch = { folders, onChange, closed: false }
      watches.push(w)
      return { close: () => void (w.closed = true) }
    },
    run:
      options.run ??
      ((command) =>
        new Promise<string>((resolve, reject) => {
          const [file = '', ...args] = command.argv
          const child = execFile(file, args, { cwd: command.cwd ?? home, timeout: command.timeout }, (err, stdout, stderr) =>
            err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout)
          )
          child.stdin?.end(command.stdin)
        })),
    command: ({ argv, cwd, env: vars }: { argv: string[]; cwd?: string | null; env?: Record<string, string> }) => {
      const pairs = Object.entries(vars ?? {}).map(([k, v]) => `${k}=${v}`)
      if (kind === 'wsl') return { file: 'wsl.exe', args: ['-d', distro, '--cd', toEnv(cwd ?? home), '-e', 'env', ...pairs, ...argv], cwd: homedir() }
      const [file = '', ...args] = argv
      return { file, args, cwd: cwd ?? home }
    },
    toEnv,
    direct: kind !== 'wsl',
  }
  return Object.assign(env, { host: env }) as unknown as Environment
}
