import { type Mascot, swapWord, withTic } from '@bidule/sdk'

// Its word: « Coin », the app's placeholder interjection, becomes it in every line.
export const word = 'Pling'

// Who it is, its voice and its place in the banner.
export const mascot: Mascot = {
  id: 'gerty',
  name: 'Gerty',
  desc: 'Robot assistant lunaire · thème base lunaire',
  theme: 'theme-moonbase',
  light: true,
  hello: 'Pling. Gerty est là pour t’aider. :)',
  lines: {
    tease: 'Pling. La CI est rouge. Ce n’est pas ta faute : on regarde ensemble, après un café ?',
    proud: 'Pling. Tout est à jour. Je suis content pour toi. :)',
  },
  sink: -30,
  // Never exclaims; its screen smiles « :) » after good news.
  speak: (msg, mode) => {
    const calm = swapWord(msg, word)
      .replace(/\s*!+/g, '.')
      .replace(/\.{2,}/g, '.')
      .replace(/\?\./g, '?')
    const out = mode !== 'sleep' && !calm.includes(word) ? withTic('Pling.', calm) : calm
    return mode === 'quack' && !out.endsWith(':)') ? `${out} :)` : out
  },
  art: () => import('./art.ts').then((m) => m.default),
}
