// A reading asked again and again (each change the core announces): only the answer to the last ask settles, so that
// a slower, older answer never overwrites a newer one. The others never settle.
export function latestOf<T>(read: () => Promise<T>): () => Promise<T> {
  let asked = 0
  return () => {
    const n = ++asked
    return new Promise<T>((resolve, reject) =>
      read().then(
        (value) => n === asked && resolve(value),
        (error: unknown) => n === asked && reject(error),
      ),
    )
  }
}
