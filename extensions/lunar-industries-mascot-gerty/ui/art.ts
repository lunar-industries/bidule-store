// Its drawings, loaded when it is first shown: SVG as text, inserted inline so that their animations run.
import type { MascotArt } from '@bidule/sdk'
import { fx, head, moods, type Effects } from '@bidule/sdk'
import svg from './svg/gerty.svg?raw'
import decor from './svg/decor-moonbase.svg?raw'

// Worried rather than cross: a drop of sweat and a question mark on its screen's side.
const effects: Effects = {
  happy: fx.heart(150, 36, 20, '#E8B931') + fx.star(22, 60, 16, '#557AA3', 0.2),
  angry: fx.sweat(152, 62, 18) + fx.mono(24, 40, '?', 'pxBlink 1s steps(1) infinite', '#B0433A', 22),
  sleep: fx.zzz(150, 44, '#4F5B68'),
  sad: fx.sweat(78, 118, 14),
}

export default {
  moods: moods(svg, 'gerty', effects),
  decor,
  head: head(svg, '70 40 280 280'),
  front: null,
} satisfies MascotArt
