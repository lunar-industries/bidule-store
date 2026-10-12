import { randomUUID } from 'node:crypto'

// Follows going on at once: a fifth stops the oldest. One left open by a page closed without saying so keeps its
// command until then (or until the API stops).
export const MAX_FOLLOWS = 4

type Follow = { id: string; key: string; count: number; stop: () => void }

/**
 * What the page follows of the engines (a container's logs, the resources), each by a long command of the engine that
 * pushes what it reads as the module's events. One follow per key, shared by the requests of the same key (a count),
 * stopped when the last one leaves; at most MAX_FOLLOWS at once. A follow whose command ends by itself (the container
 * removed, the engine stopped) is forgotten (`ended`).
 */
export class Follows {
  // By key, oldest first.
  #byKey = new Map<string, Follow>()

  // Joins the follow of `key`, started by `start` (given the follow's id, it gives how to stop it) when none goes on;
  // the follow's id.
  join(key: string, start: (id: string) => () => void): string {
    const known = this.#byKey.get(key)
    if (known) {
      known.count += 1
      return known.id
    }
    const follow: Follow = { id: randomUUID(), key, count: 1, stop: () => {} }
    this.#byKey.set(key, follow)
    try {
      follow.stop = start(follow.id)
    } catch (err) {
      // Not started: it takes no place.
      this.#byKey.delete(key)
      throw err
    }
    for (const old of [...this.#byKey.values()].slice(0, -MAX_FOLLOWS)) this.#end(old)
    return follow.id
  }

  // One request less; the last one stops it. An unknown id (already ended) changes nothing.
  leave(id: string): void {
    const follow = this.#find(id)
    if (follow && --follow.count <= 0) this.#end(follow)
  }

  // Its command ended by itself.
  ended(id: string): void {
    const follow = this.#find(id)
    if (follow) this.#byKey.delete(follow.key)
  }

  #find(id: string): Follow | undefined {
    return [...this.#byKey.values()].find((f) => f.id === id)
  }

  #end(follow: Follow) {
    this.#byKey.delete(follow.key)
    follow.stop()
  }
}
