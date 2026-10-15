// Its drawings, loaded when it is first shown: SVG as text, inserted inline so that their animations run.
import type { MascotArt } from '@bidule/sdk'
import { fx, head, moods, type Effects } from '@bidule/sdk'
import svg from './svg/hal.svg?raw'
import decor from './svg/decor-discovery.svg?raw'

// Everything is in the eye: around it, only stars, an error that blinks, and z in a terminal font.
const effects: Effects = {
  happy: fx.star(150, 30, 20, '#FF9A4D') + fx.star(18, 60, 12, '#8AABD0', 0.3),
  angry: fx.mono(140, 30, 'ERR', 'pxBlink 1s steps(1) infinite', '#FF5A4E', 18),
  sleep: ['z', 'Z']
    .map((z, i) => fx.mono(150, 40, z, `zzz 3s ease-in ${i * 1.5}s infinite`, '#8AABD0', 20 + i * 8))
    .join(''),
  sad: fx.sweat(89, 162, 14),
}

export default {
  moods: moods(svg, 'hal', effects),
  decor,
  head: head(svg, '70 40 280 280'),
  front: null,
} satisfies MascotArt
