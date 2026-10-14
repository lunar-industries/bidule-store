import type { ObjectsContext } from '@bidule/api/extensions'
import type { SharedSettings } from '@bidule/ext-lunar-industries-common/contract'
import type { ForgeClient } from '@bidule/sdk/forges'
import type { StoredObject } from '@bidule/sdk/objects'
import { issueOf } from './names.ts'

export interface IssueLinksDeps {
  // The core's objects: these branches, the tasks, the client on a repo's forge (`review.forge`), the links.
  objects: Pick<ObjectsContext, 'relations' | 'link' | 'unlink'> & {
    branches(ids: string[]): Promise<StoredObject<'branch'>[]>
    tasks(): Promise<Task[]>
    forgeOf(repositoryId: string): Promise<ForgeClient | null>
  }
  settings(): Promise<Pick<SharedSettings, 'template' | 'integrationBranches'>>
  // The links' origin: the module's id. Never `manual` (the user's) nor `ref` (the core's rule on names).
  origin: string
}

type Task = StoredObject<'task'>

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The task an issue's text cites (« Tâche : ACC-42 — Titre » and its page, as the issues the modules open say): its
 * page's address, else its reference as a whole word (ACC-4 is not cited by ACC-42), the first one in the text.
 */
export function taskCited(text: string, tasks: readonly Task[]): Task | null {
  const at = (t: Task) => {
    if (t.url && text.includes(t.url)) return text.indexOf(t.url)
    if (!t.ref) return -1
    return text.search(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(t.ref)}(?![A-Za-z0-9])`, 'i'))
  }
  return (
    tasks
      .map((task) => ({ task, at: at(task) }))
      .filter((c) => c.at >= 0)
      .sort((a, b) => a.at - b.at)[0]?.task ?? null
  )
}

/**
 * Branches named after their issue (« Nommage des branches » : 488-ajout-role) cite no task: the core's rule on names
 * cannot link them. Their issue's text does: the branch is linked to the task it cites, a link of the module's own
 * origin. It runs on the branches git announces, never on all of them; a task announced later is looked for in the
 * texts already read, without asking the forge again. Whatever links the branch otherwise (by hand, its `noTask` mark,
 * a reference in its name) wins: the module's link goes.
 */
export class IssueLinks {
  // An issue's text by `<repositoryId> <number>`: read once; null when the forge has no such issue.
  #texts = new Map<string, string | null>()
  // Branches whose issue cites no task the core has yet.
  #waiting = new Set<string>()
  #queue: Promise<void> = Promise.resolve()

  constructor(protected deps: IssueLinksDeps) {}

  // One look at a time: two announcements in a row would link the same branch twice.
  #serial(work: () => Promise<void>): Promise<void> {
    this.#queue = this.#queue.then(work, work)
    return this.#queue
  }

  branchesChanged(ids: string[]): Promise<void> {
    return this.#serial(() => this.#settle(ids))
  }

  // The branches waiting for a task, and those the module linked (their task may be gone, or linked otherwise now).
  tasksChanged(): Promise<void> {
    return this.#serial(async () => {
      const ours = (await this.#links()).filter((l) => l.origin === this.deps.origin).map((l) => l.to.id)
      const ids = [...new Set([...this.#waiting, ...ours])]
      if (ids.length) await this.#settle(ids)
    })
  }

  #links() {
    return this.deps.objects.relations({ kind: 'branch', fromType: 'task', toType: 'branch' })
  }

  // The text read before, else the forge's (undefined: no forge, or no token, or the forge did not answer).
  async #text(repositoryId: string, n: number): Promise<string | null | undefined> {
    const key = `${repositoryId} ${n}`
    if (this.#texts.has(key)) return this.#texts.get(key)
    try {
      const client = await this.deps.objects.forgeOf(repositoryId)
      if (!client) return undefined
      const text = (await client.issue(n))?.description ?? null
      this.#texts.set(key, text)
      return text
    } catch {
      return undefined
    }
  }

  async #settle(ids: string[]) {
    const { objects, origin } = this.deps
    const { template, integrationBranches } = await this.deps.settings()
    const integration = new Set(integrationBranches.map((n) => n.toLowerCase()))
    const [branches, links, marks] = await Promise.all([
      objects.branches(ids),
      this.#links(),
      objects.relations({ kind: 'noTask', fromType: 'branch', toType: 'branch' }),
    ])
    let tasks: Task[] | null = null
    for (const b of branches) {
      const ref = { type: 'branch' as const, id: b.id }
      const linked = links.filter((l) => l.to.id === b.id)
      const ours = linked.filter((l) => l.origin === origin)
      const keep = async (taskId: string | null) => {
        for (const l of ours) if (l.from.id !== taskId) await objects.unlink(l.from, 'branch', ref, origin)
        if (taskId && !ours.some((l) => l.from.id === taskId)) await objects.link({ type: 'task', id: taskId }, 'branch', ref, origin)
      }
      this.#waiting.delete(b.id)
      const n = issueOf(template, b.name)
      const otherwise = linked.length > ours.length || marks.some((m) => m.from.id === b.id)
      if (b.isDefault || integration.has(b.name.toLowerCase()) || otherwise || n === null) {
        await keep(null)
        continue
      }
      const text = await this.#text(b.repositoryId, n)
      // Unread for now: what was linked stays, and the next announcement of the branch tries again.
      if (text === undefined) continue
      tasks ??= await objects.tasks()
      const task = text ? taskCited(text, tasks) : null
      if (!task && text) this.#waiting.add(b.id)
      await keep(task?.id ?? null)
    }
  }
}
