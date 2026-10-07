// Plane holds the text of a work item and of its comments as HTML; a session or a conversation reads plain text with
// a little Markdown, as Notion's pages are given to them.

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** The text of some HTML: headings as `#`, list items as `-`, one line a paragraph, no tag. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return (
    html
      // What is not text at all goes with its content.
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<h[1-6][^>]*>/gi, '\n# ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|ul|ol|pre|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** Some text as the HTML of a comment: a paragraph a block of lines, a line break between lines. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('')
}
