import type { Task } from '@bidule/sdk'
import type { ForgeKind, ListedBranch, Listing } from '../contract.ts'

// Taken from quack-board (Simon's pages/branches/branches.ts): where a branch stands among its four steps (linked to
// a task, under review, CI, merged), what the table says of it and the one thing to do now, and the table itself, by
// repo.

export type Step = 'task' | 'review' | 'ci' | 'merge' | 'done'
export const STEPS: { id: Exclude<Step, 'done'>; label: string }[] = [
  { id: 'task', label: 'Tâche' },
  { id: 'review', label: 'Revue' },
  { id: 'ci', label: 'CI' },
  { id: 'merge', label: 'Fusion' },
]
export type StepState = 'done' | 'current' | 'todo'

// How a forge names a review: a merge request elsewhere than on GitHub.
export const REVIEW: Partial<Record<ForgeKind, string>> = { gitlab: 'MR', github: 'PR' }
export const FORGE: Partial<Record<ForgeKind, string>> = { gitlab: 'GitLab', github: 'GitHub' }

export function stepOf(b: ListedBranch): Step {
  if (!b.taskId) return 'task'
  if (b.reviewState === 'merged') return 'done'
  if (!b.forge || !b.reviewNumber || b.reviewState === 'closed') return 'review'
  if (b.ci === 'pending' || b.ci === 'fail') return 'ci'
  return 'merge'
}

// How a state reads: its tone (its colour), and whether it waits for the user (the row's dot, the sort's first rows).
export type Tone = 'bad' | 'warn' | 'ok' | 'info' | 'neutral'
export type State = { text: string; tone: Tone; yours: boolean }

/**
 * What the table says of a branch, in words. A review whose real state is not read yet (no draft known) is « Revue
 * ouverte », never « Prête à fusionner ».
 */
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function stateOf(b: ListedBranch, step: Step, review: string): State {
  if (step === 'task') return { text: 'Sans tâche', tone: 'warn', yours: true }
  if (step === 'done') return { text: 'Fusionnée', tone: 'neutral', yours: false }
  if (!b.forge) return { text: 'Liée, sans forge', tone: 'neutral', yours: false }
  if (step === 'review') {
    if (b.reviewState === 'closed') return { text: `${capital(review)} fermée`, tone: 'bad', yours: true }
    return b.pushed ? { text: 'À proposer', tone: 'warn', yours: true } : { text: 'À pousser', tone: 'warn', yours: true }
  }
  if (b.ci === 'fail') return { text: 'CI rouge', tone: 'bad', yours: true }
  if (b.ci === 'pending') return { text: 'CI en cours', tone: 'info', yours: false }
  if (b.reviewDraft === true) return { text: `${capital(review)} en brouillon`, tone: 'warn', yours: true }
  if (b.reviewDraft === false) return { text: 'Prête à fusionner', tone: 'ok', yours: true }
  return { text: 'Revue ouverte', tone: 'neutral', yours: false }
}

// The one thing to do now, the table's last column: a write (confirmed first), or the drawer opened.
export type ActionKind = 'link' | 'push' | 'review' | 'retry' | 'ready' | 'merge' | 'open'
export function actionOf(b: ListedBranch, step: Step, review: string): { kind: ActionKind; label: string } {
  if (step === 'task') return { kind: 'link', label: 'Lier…' }
  if (step === 'review' && b.forge && b.reviewState !== 'closed')
    return b.pushed ? { kind: 'review', label: `Créer la ${review}…` } : { kind: 'push', label: 'Pousser…' }
  if (step === 'ci' && b.ci === 'fail') return { kind: 'retry', label: 'Relancer…' }
  if (step === 'merge' && b.reviewDraft === true) return { kind: 'ready', label: 'Sortir du brouillon…' }
  if (step === 'merge' && b.reviewDraft === false) return { kind: 'merge', label: 'Fusionner…' }
  return { kind: 'open', label: 'Voir' }
}

export const branchKey = (b: { repo: string; name: string }) => `${b.repo}\u0000${b.name}`

// A branch with what the table and the drawer show.
export function rowOf(b: ListedBranch, tasks: Task[]) {
  // A merge request on GitLab, a pull request on GitHub, a review when the forge is not known.
  const review = (b.forge && REVIEW[b.forge]) || 'revue'
  const step = stepOf(b)
  const reached = step === 'done' ? STEPS.length : STEPS.findIndex((s) => s.id === step)
  const stateAt = (i: number): StepState => (i < reached ? 'done' : i === reached ? 'current' : 'todo')
  return {
    ...b,
    key: branchKey(b),
    task: tasks.find((t) => t.id === b.taskId) ?? null,
    // Every task it serves that the board knows, in the order of `taskIds`.
    tasks: b.taskIds.flatMap((id) => tasks.filter((t) => t.id === id)),
    review,
    reviewLabel: b.reviewNumber ? `${review} ${b.forge === 'gitlab' ? '!' : '#'}${b.reviewNumber}` : null,
    forgeName: (b.forge && FORGE[b.forge]) || 'la forge',
    step,
    state: stateOf(b, step, review),
    action: actionOf(b, step, review),
    // The table's progress bar: the steps done so far.
    progress: STEPS.map((_, i) => i < reached),
    steps: STEPS.map((s, i) => ({ ...s, state: stateAt(i) })),
  }
}
export type Row = ReturnType<typeof rowOf>

// What the table shows: the branches being worked on (not merged), those without a task, or all of them.
export type Filter = 'current' | 'orphans' | 'all'
export const FILTERS: { key: Filter; label: string }[] = [
  { key: 'current', label: 'En cours' },
  { key: 'orphans', label: 'Sans tâche' },
  { key: 'all', label: 'Toutes' },
]
const shownBy = (filter: Filter) => (b: ListedBranch) =>
  filter === 'all' ? true : filter === 'orphans' ? !b.taskId && b.reviewState !== 'merged' : b.reviewState !== 'merged'
export const countsOf = (branches: ListedBranch[]): Record<Filter, number> => ({
  current: branches.filter(shownBy('current')).length,
  orphans: branches.filter(shownBy('orphans')).length,
  all: branches.length,
})

// The table's order: what waits for the user first (a red CI, a closed review), then the rest by name or by commit.
export type Sort = 'state' | 'name' | 'commit'
const TONES: Tone[] = ['bad', 'warn', 'ok', 'info', 'neutral']
const rank = (r: Row) => (r.step === 'done' ? TONES.length : TONES.indexOf(r.state.tone) - (r.state.yours ? 0.5 : 0))
export function sortRows(rows: Row[], sort: Sort): Row[] {
  const byCommit = (a: Row, b: Row) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? '')
  return [...rows].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name, 'fr') : sort === 'commit' ? byCommit(a, b) : rank(a) - rank(b) || byCommit(a, b)
  )
}

/**
 * The repos as the table shows them: the branches the filter keeps and the search finds (in the name, the repo, the
 * title or reference of one of its tasks), in the sort's order; a repo without a target of its own takes the settings'
 * one when it has that branch.
 */
export function reposOf(listing: Listing, tasks: Task[], filter: Filter, sort: Sort = 'state', query = '') {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const found = (r: Row) => {
    const text = fold(`${r.name} ${r.repoLabel} ${r.tasks.map((t) => `${t.title} ${t.ref ?? ''}`).join(' ')}`)
    return words.every((w) => text.includes(w))
  }
  const byRepo = new Map<string, ListedBranch[]>()
  for (const b of listing.branches) byRepo.set(b.repo, [...(byRepo.get(b.repo) ?? []), b])
  const known = new Map(listing.repos.map((r) => [r.path, r]))
  for (const r of listing.repos) if (!byRepo.has(r.path)) byRepo.set(r.path, [])
  return [...byRepo].map(([path, branches]) => {
    const repo = known.get(path)
    const targets = repo?.targets ?? []
    const fallback = listing.defaultTarget
    const inherited = fallback && targets.includes(fallback) ? fallback : null
    const rows = sortRows(branches.filter(shownBy(filter)).map((b) => rowOf(b, tasks)).filter(found), sort)
    return {
      path,
      label: repo?.label ?? branches[0]?.repoLabel ?? path,
      target: repo?.reviewTarget ?? inherited,
      targets,
      count: branches.length,
      yours: rows.filter((r) => r.state.yours).length,
      rows,
    }
  })
}
export type RepoView = ReturnType<typeof reposOf>[number]

// The branches to link: recent (a commit these last 14 days), without a task, not merged.
const RECENT_DAYS = 14
export const isRecent = (at: string | null, now = Date.now()) =>
  Boolean(at && now - new Date(at).getTime() < RECENT_DAYS * 864e5)
export const orphansOf = (branches: ListedBranch[], now = Date.now()) =>
  branches.filter((b) => !b.taskId && b.reviewState !== 'merged' && isRecent(b.lastCommitAt, now))

export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// « 3 h »: the branch's last commit, short for the table.
export function relTime(at: string | null, now = Date.now()): string {
  if (!at) return '—'
  const minutes = Math.round((now - new Date(at).getTime()) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / 1440)
  return days < 30 ? `${days} j` : new Date(at).toLocaleDateString('fr-FR')
}
