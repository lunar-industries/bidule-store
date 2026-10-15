import { type Mascot, swapWord } from '@bidule/sdk'

// Its word: « Coin », the app's placeholder interjection, becomes it in every line.
export const word = 'Bien'

// « , Dave » at the end of the first sentence, after a leading « Bien. » when there is one.
function toDave(msg: string): string {
  if (msg.includes('Dave')) return msg
  const lead = new RegExp(`^${word}[.…]\\s+`).exec(msg)?.[0] ?? ''
  const rest = msg.slice(lead.length)
  if (!rest) return msg
  const end = rest.search(/\s*[.?…]/)
  return end < 0 ? `${lead}${rest}, Dave` : `${lead}${rest.slice(0, end)}, Dave${rest.slice(end)}`
}

// Who it is, its voice and its place in the banner.
export const mascot: Mascot = {
  id: 'hal',
  name: 'HAL',
  desc: 'Ordinateur de bord · thème discovery',
  theme: 'theme-discovery',
  light: false,
  hello: 'Bien. HAL est en ligne, Dave. Tout fonctionne parfaitement.',
  lines: {
    tease: 'La CI est rouge, Dave. Une erreur humaine, sans aucun doute. J’en suis sincèrement navré.',
    proud: 'Bien. Tout est à jour, Dave. Je n’ai jamais douté du résultat.',
  },
  sink: -30,
  // Never raises its voice, and speaks to Dave.
  speak: (msg, mode) => {
    const calm = swapWord(msg, word)
      .replace(/\s*!+/g, '.')
      .replace(/\.{2,}/g, '.')
      .replace(/\?\./g, '?')
    return mode === 'sleep' ? calm : toDave(calm)
  },
  art: () => import('./art.ts').then((m) => m.default),
}
