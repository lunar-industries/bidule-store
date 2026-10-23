// Kanban (Lunar Industries): Simon's Kanban (quack-board), an unofficial one competing with Bidule's own (`kanban`).
// The board itself comes from the core, as for any Kanban: the user's tasks (GET /api/tasks, readTasks), moved by the
// object action `task.move`, and the other modules' parts of the cards through the point `kanban`, which it declares
// like the official one. The branches of the cards are the core's objects (branches, their repository, review and
// pipeline, their task's link), read and linked by lunar-industries-common's commands, through the module's own
// routes, under /api/ext/lunar-industries-kanban:
//   GET branches                 { available, branches: KanbanBranch[] }   (available: someone provides branches)
//   PUT tasks/:id/branches       { branches: BranchRef[] } → { branches: KanbanBranch[] }
//   GET review?repo&name         { url }  (the branch's review, else its pipeline)
import type {} from '@bidule/ext-lunar-industries-common/contract'
import type { Ci, ReviewState } from '@bidule/sdk/objects'

// A branch by its repository's path and its name.
export type BranchRef = { repo: string; name: string }

// A branch as the cards and the tray show it: its review and CI when a forge has them.
export type KanbanBranch = {
  repo: string
  repoLabel: string
  name: string
  // The first of `taskIds` (linked by hand first); a branch can serve several tasks.
  taskId: string | null
  taskIds: string[]
  isDefault: boolean
  lastCommitAt: string | null
  reviewNumber: number | null
  // How the forge cites it: « PR #12 », « MR !12 ».
  reviewRef: string | null
  reviewState: ReviewState | null
  ci: Ci | null
  // Its review's address, else its pipeline's, as the forges gave them: a mark opens it at once (null: asked of the
  // forge, GET review).
  url: string | null
}

export type Branches = { available: boolean; branches: KanbanBranch[] }
