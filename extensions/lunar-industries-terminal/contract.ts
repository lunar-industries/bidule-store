// The `terminal` role, which this extension provides: a tab running what the others prepared in the API
// (ctx.terminal.prepare). Another provider of the role declares the same commands; the one holding it answers them.

// What a tab's mark says: something works there, waits for the user, is done, or failed.
export type TerminalMark = 'working' | 'waiting' | 'done' | 'failed'

declare module '@bidule/sdk/contracts' {
  interface Commands {
    'terminal.new': (args: void) => void
    // A tab with a prepared command; `folder` says where it works (its tab is named after it).
    'terminal.open': (args: { session: string; title: string; folder?: string }) => void
    // A shell where a task is worked on (the worktree of its branch, else its repo), the tab named after it: a task
    // card's menu. Interface only.
    'terminal.task': (args: { taskId: string }) => void
    // A shell on a branch (by its id in the core: the worktree it is checked out in, else its repo's main copy), the
    // tab named after it: Git's page. A command of the role `terminal`, whoever holds it. Interface only.
    'terminal.branch': (args: { branchId: string }) => void
  }
}
