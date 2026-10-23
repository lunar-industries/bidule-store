// Commun (Lunar Industries): what the Lunar Industries modules share, written once. An extension cannot import
// another's code at run time, nor read its settings: the modules ask this one by its commands
// (`ctx.commands.execute`), after declaring it in their `dependencies` (the store installs it with them). It has no page
// and competes with no official module. Types only.
import type { Ci, ReviewState } from '@bidule/sdk/objects'

// A branch as the core has it, put together once for every Lunar Industries module.
export type SharedBranch = {
  id: string
  repositoryId: string
  // Its repo's absolute path identifies it; its label is what is shown.
  repo: string
  repoLabel: string
  name: string
  isDefault: boolean
  // One of the integration branches (the setting, whatever the case): it belongs to no task.
  integration: boolean
  // The task linked by hand first, else the one the core's rule linked; null without one.
  taskId: string | null
  // Every task it is linked to, those linked by hand first: a branch can serve several tasks.
  taskIds: string[]
  lastCommitAt: string | null
  // Its last commit here: the one CI ran on.
  headSha: string | null
  reviewNumber: number | null
  // How the forge cites its latest review (« MR !12 »).
  reviewRef: string | null
  reviewState: ReviewState | null
  // `merged` once the review is; else its last commit's pipeline (`none`: a review without one); null when no forge
  // read the branch.
  ci: Ci | null
  // Where its review is, else its pipeline.
  url: string | null
}

// Which branches: those a task links (`taskId`), else a repo's (`repo`, one of them with `name`), else all.
export type BranchFilter = { taskId?: string; repo?: string; name?: string }

// The settings the modules share (Réglages › Commun).
export type SharedSettings = {
  // As written, without the empty ones: compared whatever their case.
  integrationBranches: string[]
  // Where a repo's reviews go when it has no target of its own; null: nobody said.
  reviewTarget: string | null
  // Each repo's own target, by its path.
  targets: Record<string, string>
  // How a task's branch is named (`issue`, `ref` or `template`), and the template that comes to.
  naming: string
  template: string
}

declare module '@bidule/sdk/contracts' {
  interface Commands {
    // The branches, newest first; `available` is false without a provider of branches.
    'lunar-industries-common.branches': (args: BranchFilter) => { available: boolean; branches: SharedBranch[] }
    // A branch linked to a task by hand, or marked as having none (taskId null): its other tasks and the opposite mark
    // go. False when the core knows neither the branch nor the task.
    'lunar-industries-common.link': (args: { repo: string; name: string; taskId: string | null }) => { linked: boolean }
    // A branch's tasks are exactly these now, linked by hand; none: marked as having none. False when the core knows
    // neither the branch nor one of the tasks.
    'lunar-industries-common.setTasks': (args: { repo: string; name: string; taskIds: string[] }) => { linked: boolean }
    'lunar-industries-common.settings': (args: void) => SharedSettings
    // A repo's own review target (null: back to the shared one); refused (404) for a repo the core does not know.
    'lunar-industries-common.setTarget': (args: { repo: string; target: string | null }) => void
  }
  interface Events {
    // A repo's own review target changed (from the Branches page, from Claude's settings…).
    'lunar-industries-common.changed': Record<string, never>
  }
}
