// What a terminal line says that the app can open: a task's reference (ID-123), a file and its line
// (src/app.ts:42), a review of the repo (!45 on GitLab, #45 on GitHub). Pure: the tabs turn these into links.

// Where a match is in the line's text: `start` included, `end` excluded.
export type Found = { start: number; end: number; text: string }

const REF = /\b([A-Za-z][A-Za-z0-9]*-\d+)\b/g

/**
 * The task references the board knows (by their ref, any case): ID-123 is a link only when a task of the user has
 * that reference, never because something looks like one (a date, a version).
 */
export function findTaskRefs(line: string, known: Map<string, string>): (Found & { ref: string })[] {
  const out: (Found & { ref: string })[] = []
  for (const m of line.matchAll(REF)) {
    const ref = known.get(m[1].toUpperCase())
    if (ref) out.push({ start: m.index, end: m.index + m[1].length, text: m[1], ref })
  }
  return out
}

// A path ending in a file with an extension, then `:line` and maybe `:column` (what compilers and test runners print).
const PATH = /(?:^|[\s('"`])((?:[A-Za-z]:[\\/]|\.{0,2}\/|~\/)?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/g

export function findFileLines(line: string): (Found & { path: string; line: number; column: number | null })[] {
  const out: (Found & { path: string; line: number; column: number | null })[] = []
  for (const m of line.matchAll(PATH)) {
    const start = m.index + m[0].length - (m[1].length + 1 + m[2].length + (m[3] ? m[3].length + 1 : 0))
    const end = m.index + m[0].length
    out.push({ start, end, text: line.slice(start, end), path: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : null })
  }
  return out
}

// A web address: ghostty-web opens one on Ctrl+click only (Cmd on macOS); the tabs open it on a plain click, like the
// official terminal. The punctuation that ends a sentence, or a closing bracket without its opening one, is not in it.
const URL_LIKE = /\bhttps?:\/\/[^\s"'`<>]+/g

export function findUrls(line: string): Found[] {
  const out: Found[] = []
  for (const m of line.matchAll(URL_LIKE)) {
    let text = m[0].replace(/[.,;:!?]+$/, '')
    while (/[)\]]$/.test(text)) {
      const close = text.at(-1)
      const open = close === ')' ? '(' : '['
      if (text.split(open).length >= text.split(close!).length) break
      text = text.slice(0, -1).replace(/[.,;:!?]+$/, '')
    }
    out.push({ start: m.index, end: m.index + text.length, text })
  }
  return out
}

// `!45` (a GitLab merge request) or `#45` (a GitHub pull request), alone: not inside a word, a URL or a colour.
const REVIEW = /(?:^|[\s(])([!#])(\d+)\b/g

export function findReviews(line: string): (Found & { kind: 'mr' | 'pr'; number: number })[] {
  const out: (Found & { kind: 'mr' | 'pr'; number: number })[] = []
  for (const m of line.matchAll(REVIEW)) {
    const start = m.index + m[0].length - (m[1].length + m[2].length)
    out.push({ start, end: start + 1 + m[2].length, text: `${m[1]}${m[2]}`, kind: m[1] === '!' ? 'mr' : 'pr', number: Number(m[2]) })
  }
  return out
}
