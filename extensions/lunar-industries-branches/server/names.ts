// Taken from quack-board (domain/branch_links.ts and connectors/forge.ts): the issue a branch name carries, and the
// text of the review opened for it. The naming's template is lunar-industries-common's setting.

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PARTS: Record<string, string> = { '{issue}': '(\\d+)', '{ref}': '[a-z0-9]+(?:[-_]?\\d+)?', '{slug}': '.+' }

// The issue number a branch name carries, when the naming has one: 488-fix-login → 488.
export function issueOf(template: string, name: string): number | null {
  if (!template.includes('{issue}')) return null
  const pattern = template
    .split(/(\{issue\}|\{ref\}|\{slug\})/)
    .map((part) => PARTS[part] ?? escapeRegExp(part))
    .join('')
  const found = new RegExp(`^${pattern}$`, 'i').exec(name)
  return found?.[1] ? Number(found[1]) : null
}

// The text of a review: it closes the branch's issue and links its task.
export function reviewDescription(issueNumber: number | null, taskUrl: string | null): string {
  return [issueNumber ? `Closes #${issueNumber}` : '', taskUrl ? `Tâche : ${taskUrl}` : ''].filter(Boolean).join('\n\n')
}
