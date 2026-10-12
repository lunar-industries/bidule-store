// A pipeline the core announces changed (`objects.changed` of type `pipeline`, said when a forge read it again): what a
// tool waiting on a pipeline wakes on, instead of asking the forge again and again.

// A wait on the announcements: `next(deadline)` is true at the first one since the last call (or since the watch
// began, so that none is missed while the waiter reads), false once the deadline passed; `close` ends it.
export interface PipelineWatch {
  next(deadline: number): Promise<boolean>
  close(): void
}

export class PipelineChanges {
  #listeners = new Set<() => void>()

  // From the module's listener of `objects.changed`.
  changed(type: string): void {
    if (type !== 'pipeline') return
    for (const listener of this.#listeners) listener()
  }

  watch(): PipelineWatch {
    let pending = false
    let wake: (() => void) | null = null
    const listener = () => {
      if (wake) wake()
      else pending = true
    }
    this.#listeners.add(listener)
    return {
      next: (deadline) => {
        if (pending) {
          pending = false
          return Promise.resolve(true)
        }
        return new Promise((resolve) => {
          // A single wait for the deadline, cleared by the announcement: not a loop.
          const timer = setTimeout(() => {
            wake = null
            resolve(false)
          }, Math.max(0, deadline - Date.now()))
          wake = () => {
            wake = null
            clearTimeout(timer)
            resolve(true)
          }
        })
      },
      close: () => {
        this.#listeners.delete(listener)
        wake = null
      },
    }
  }
}
