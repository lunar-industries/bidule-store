// The OSC sequences (`ESC ] code ; data`, ended by BEL or ST) in a shell's output, read as it arrives. xterm.js handed
// them to the official terminal (parser.registerOscHandler); ghostty-web has no such hook, so the tabs read them here,
// before the output goes to the terminal (which still gets all of it). A sequence may be cut between two chunks: its
// start is kept until its end arrives. Pure.

export type Osc = { code: number; data: string }

const ESC = '\x1b'
const BEL = '\x07'
// A sequence longer than this is not one of the marks read here (a picture, a long clipboard): it is dropped, not kept.
export const OSC_MAX = 64 * 1024

export class OscReader {
  // The start of a sequence not ended yet (from its ESC), or a lone ESC at the end of the last chunk.
  #pending = ''

  // The sequences ended in this chunk, in order.
  read(chunk: string): Osc[] {
    const text = this.#pending + chunk
    this.#pending = ''
    if (!text.includes(ESC)) return []
    const found: Osc[] = []
    let at = text.indexOf(`${ESC}]`)
    while (at >= 0) {
      const body = at + 2
      let end = -1
      let next = body
      for (let i = body; i < text.length; i++) {
        const c = text[i]
        if (c === BEL) {
          end = i
          next = i + 1
          break
        }
        if (c === ESC) {
          // ST (ESC \) ends it; ESC at the very end may be the start of ST; any other ESC cuts it short.
          if (i + 1 >= text.length) break
          if (text[i + 1] === '\\') {
            end = i
            next = i + 2
          } else next = -i
          break
        }
      }
      if (end >= 0) {
        const osc = parse(text.slice(body, end))
        if (osc) found.push(osc)
      } else if (next < 0) {
        // Cut short by another escape: dropped, and read again from that escape.
        at = text.indexOf(`${ESC}]`, -next)
        continue
      } else {
        const rest = text.slice(at)
        if (rest.length <= OSC_MAX) this.#pending = rest
        return found
      }
      at = text.indexOf(`${ESC}]`, next)
    }
    // A chunk that ends on ESC: the next one may start with `]`.
    if (text.endsWith(ESC)) this.#pending = ESC
    return found
  }
}

// `133;D;0` → { code: 133, data: 'D;0' }; `7;file://…` → { code: 7, data: 'file://…' }; null without a numeric code.
function parse(body: string): Osc | null {
  const semi = body.indexOf(';')
  const code = semi < 0 ? body : body.slice(0, semi)
  if (!/^\d{1,4}$/.test(code)) return null
  return { code: Number(code), data: semi < 0 ? '' : body.slice(semi + 1) }
}
