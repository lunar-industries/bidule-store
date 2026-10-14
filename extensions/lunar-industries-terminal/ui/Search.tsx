import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { terminals } from './tabs.ts'

/**
 * Searching the active tab's scrollback (Ctrl+Shift+F; the pane with the focus in a split tab): Enter goes to the next
 * match, Shift+Enter to the previous one, Escape closes; the match shown is selected, and the matches are counted.
 * Another tab or pane chosen meanwhile is searched in turn.
 */
export function TerminalSearch() {
  'use no memo'
  useSyncExternalStore(terminals.subscribe, terminals.version)
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const tab = terminals.active
  // The pane with the focus: in a split tab, the search follows it.
  const pane = tab?.pane
  // What the search found there, for this text and these options (the pane keeps its last search).
  const found = pane?.found && pane.found.query === text && pane.found.caseSensitive === caseSensitive ? pane.found : null

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  // The text as typed, read when the pane changes: typing searches by itself (`search` below), without watching anew.
  const searchHere = useEffectEvent((here: NonNullable<typeof tab>) => terminals.find(text, { caseSensitive, typed: true }, here))

  // Searched again when another tab or pane is chosen, or the options change.
  useEffect(() => {
    if (tab && pane) searchHere(tab)
  }, [tab, pane, caseSensitive])

  const search = (value: string) => {
    setText(value)
    terminals.find(value, { caseSensitive, typed: true })
  }
  const count = !text || !found ? '' : found.matches.length === 0 ? 'Aucun' : `${found.index + 1}/${found.matches.length}`

  return (
    <div className="row lterm-search" role="search">
      <input
        ref={input}
        type="search"
        aria-label="Rechercher dans le terminal"
        placeholder="Rechercher…"
        value={text}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            terminals.closeSearch()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            terminals.find(text, { caseSensitive, backwards: e.shiftKey })
          }
        }}
      />
      <span className="lterm-search-count" aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={caseSensitive}
        aria-label="Respecter la casse"
        title="Respecter la casse"
        onClick={() => setCaseSensitive(!caseSensitive)}
      >
        Aa
      </button>
      <button type="button" className="icon-btn" aria-label="Précédent" title="Précédent (Maj+Entrée)" onClick={() => terminals.find(text, { caseSensitive, backwards: true })}>
        ↑
      </button>
      <button type="button" className="icon-btn" aria-label="Suivant" title="Suivant (Entrée)" onClick={() => terminals.find(text, { caseSensitive })}>
        ↓
      </button>
      <button type="button" className="icon-btn" aria-label="Fermer la recherche" title="Fermer (Échap)" onClick={() => terminals.closeSearch()}>
        ×
      </button>
    </div>
  )
}
