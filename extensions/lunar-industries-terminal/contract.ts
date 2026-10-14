// The `terminal` role, which this extension provides: a tab running what the others prepared in the API
// (ctx.terminal.prepare). Another provider of the role declares the same commands; the one holding it answers them.

// What a tab's mark says: something works there, waits for the user, is done, or failed.
export type TerminalMark = 'working' | 'waiting' | 'done' | 'failed'

declare module '@bidule/sdk/contracts' {
  interface Commands {
    'terminal.new': (args: void) => void
    // A tab with a prepared command; `folder` says where it works (the Claude page shows which folders have one).
    'terminal.open': (args: { session: string; title: string; folder?: string }) => void
    // The folders of the tabs still running (interface only).
    'terminal.folders': (args: void) => string[]
    // A mark on the tabs working in `folder` (what a session there is doing: Claude Code waits for an answer…), or
    // none (`state` null). Interface only.
    'terminal.mark': (args: { folder: string; state: TerminalMark | null; label?: string }) => void
    // A shell where a task is worked on (the worktree of its branch, else its repo), the tab named after it: the
    // Kanban's right click. Interface only.
    'terminal.task': (args: { taskId: string }) => void
    // A shell on a branch (the worktree it is checked out in, else its repo), the tab named after it: Git's page.
    // Interface only.
    'terminal.branch': (args: { repo: string; name: string }) => void
  }
}

