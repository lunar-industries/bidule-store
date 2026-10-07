import { describe, expect, test } from 'vitest'
import { htmlToText, textToHtml } from '../server/text.ts'

describe('Plane’s HTML as text', () => {
  test('headings, list items and paragraphs become lines, tags and entities go', () => {
    const html = '<h2>Contexte</h2><p>Un &amp; deux<br>trois</p><ul><li>a</li><li>b &lt; c</li></ul>'
    expect(htmlToText(html)).toBe('# Contexte\nUn & deux\ntrois\n\n- a\n- b < c')
  })

  test('a script or a style is dropped with its content, and nothing gives nothing', () => {
    expect(htmlToText('<style>p { color: red }</style><p>Texte</p><script>alert(1)</script>')).toBe('Texte')
    expect(htmlToText(null)).toBe('')
    expect(htmlToText('')).toBe('')
  })
})

describe('a comment’s text as HTML', () => {
  test('a paragraph a block of lines, a break between lines, the markup escaped', () => {
    expect(textToHtml('Salut <b>toi</b>\nça va ?\n\nMerci & à plus')).toBe(
      '<p>Salut &lt;b&gt;toi&lt;/b&gt;<br>ça va ?</p><p>Merci &amp; à plus</p>'
    )
  })

  test('what comes back from HTML to text is what was written, a paragraph a line', () => {
    expect(htmlToText(textToHtml('Une ligne\nune autre & <son> balisage'))).toBe('Une ligne\nune autre & <son> balisage')
    expect(htmlToText(textToHtml('Un paragraphe\n\nUn autre'))).toBe('Un paragraphe\nUn autre')
  })
})
