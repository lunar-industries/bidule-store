import { describe, expect, test } from 'vitest'
import { deployBranchesToKeep, fillTaskText } from '../server/settings.ts'

describe('the text of a task, from the model', () => {
  const task = { title: 'Ordre des colonnes', ref: 'LUN-12', url: 'https://plane.example/x/LUN-12' }

  test('{url}, {ref} and {titre} become the task’s, the rest stays as it is', () => {
    expect(fillTaskText('{url}', task)).toBe(task.url)
    expect(fillTaskText('Tâche Plane : {ref} — {titre} ({url})', task)).toBe(
      'Tâche Plane : LUN-12 — Ordre des colonnes (https://plane.example/x/LUN-12)'
    )
    expect(fillTaskText('{inconnu} {titre}', task)).toBe('{inconnu} Ordre des colonnes')
  })

  test('what the task does not have is left empty', () => {
    expect(fillTaskText('{url}', { title: 'T', ref: null, url: null })).toBe('')
  })
})

// The values as the settings table keeps them: JSON.
describe('the old production branches, kept for an install that used them', () => {
  test('a module that served without the setting saved keeps the old default', () => {
    expect(deployBranchesToKeep(undefined, true)).toBe('"launchpad, orbit"')
  })

  test('a value saved by the user is left alone, even an empty one', () => {
    expect(deployBranchesToKeep('"prod"', true)).toBeNull()
    expect(deployBranchesToKeep('""', true)).toBeNull()
  })

  test('a new install gets nothing: no production branch', () => {
    expect(deployBranchesToKeep(undefined, false)).toBeNull()
  })
})
