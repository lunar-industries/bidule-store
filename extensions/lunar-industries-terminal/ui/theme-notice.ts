import { useEffect } from 'react'
import { react } from '@bidule/sdk'
import { terminals } from './tabs.ts'

// The theme class on the page (`theme-night`, `theme-dojo`…), on the root or the body.
const themeOf = () =>
  [...document.documentElement.classList, ...document.body.classList].find((c) => c.startsWith('theme-')) ?? ''

/**
 * A theme chosen while terminals are open: ghostty-web cannot paint an open terminal again (it gives its cells their
 * colours as they are written), so the mascot says the new theme holds for the next ones; the open ones keep theirs,
 * their panes' background included (tabs.ts).
 */
export function useThemeNotice(): void {
  useEffect(() => {
    let shown = themeOf()
    const watch = new MutationObserver(() => {
      const now = themeOf()
      if (now === shown) return
      shown = now
      if (!terminals.tabs.length) return
      const line = 'Ce thème vaudra pour les prochains terminaux : ceux qui sont ouverts gardent le leur.'
      react('quack', line, line)
    })
    for (const el of [document.documentElement, document.body]) watch.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => watch.disconnect()
  }, [])
}
