import { describe, expect, test } from 'vitest'
import { writeMove } from '../ui/api.ts'

describe('a move into a column with merged statuses', () => {
  // A tool that only knows some statuses, as Notion refuses one it does not have.
  const tool = (known: string[]) => {
    const asked: string[] = []
    const move = async (_id: string, status: string) => {
      asked.push(status)
      if (!known.includes(status)) throw new Error(`Le statut « ${status} » n'existe pas`)
    }
    return { asked, move }
  }

  test('stops at the first status the tool takes', async () => {
    const { asked, move } = tool(['En cours/dev'])
    await writeMove({ id: 't' }, ['En cours', 'En cours/dev', 'Dev'], move)
    expect(asked).toEqual(['En cours', 'En cours/dev'])
  })

  test('when the tool takes none, says its first refusal', async () => {
    const { asked, move } = tool([])
    await expect(writeMove({ id: 't' }, ['En cours', 'Dev'], move)).rejects.toThrow('« En cours »')
    expect(asked).toEqual(['En cours', 'Dev'])
  })
})
