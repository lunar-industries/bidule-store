// What this extension offers the others, besides the `tasks` role (see @bidule/sdk/tasks).
declare module '@bidule/sdk/contracts' {
  interface Commands {
    // Mirrors the user's Plane work items now; says how many there are.
    'lunar-industries-plane.sync': (args: void) => { message: string }
  }
}

export {}
