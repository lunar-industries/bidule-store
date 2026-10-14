// Searching a terminal's lines (its scrollback, then its screen): xterm.js had its search addon, ghostty-web has none.
// The tabs read the lines, this finds the matches and picks the next one. Pure.

// A match: the line (0 is the oldest of the scrollback) and where it is in that line's text.
export type Match = { row: number; start: number; end: number }

// Every match of `query` in the lines, in reading order; a match never spans two lines.
export function findMatches(lines: string[], query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const found: Match[] = []
  lines.forEach((line, row) => {
    const hay = caseSensitive ? line : line.toLocaleLowerCase()
    // The lowercase of a few characters is longer than they are (İ): such a line is searched as it is.
    const text = hay.length === line.length ? hay : line
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      found.push({ row, start: at, end: at + needle.length })
    }
  })
  return found
}

const before = (a: { row: number; start: number }, b: { row: number; start: number }) =>
  a.row < b.row || (a.row === b.row && a.start < b.start)

/**
 * The match to show, from `from` (the current match, else where the view is): the next one (`backwards`: the previous
 * one), round the ends. `stay` keeps a match that starts at `from` (the text typed grew: the same place still matches).
 * -1 without any match.
 */
export function pickMatch(
  matches: Match[],
  from: { row: number; start: number },
  options: { backwards?: boolean; stay?: boolean } = {},
): number {
  if (!matches.length) return -1
  if (options.backwards) {
    for (let i = matches.length - 1; i >= 0; i--) if (before(matches[i], from)) return i
    return matches.length - 1
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (before(from, m) || (options.stay && m.row === from.row && m.start === from.start)) return i
  }
  return 0
}

// The view (lines scrolled back from the bottom, as ghostty-web counts them) that shows `row` a third of the way down,
// or the current one when the row is already in sight.
export function viewFor(row: number, current: number, scrollback: number, rows: number): number {
  const top = scrollback - current
  if (row >= top && row < top + rows) return current
  return Math.max(0, Math.min(scrollback, scrollback - row + Math.floor(rows / 3)))
}
