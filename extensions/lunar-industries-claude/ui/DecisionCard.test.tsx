// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Decision } from '../contract.ts'
import { DecisionCard } from './DecisionCard.tsx'
import type { Permission } from './events.ts'

afterEach(cleanup)

const card: Permission = {
  seq: 1,
  kind: 'permission',
  id: 'q1',
  name: 'AskUserQuestion',
  detail: '',
  ask: 'question',
  canAlways: false,
  plan: null,
  questions: [
    {
      question: 'Quel séparateur ?',
      header: 'Séparateur',
      multiSelect: false,
      options: [
        { label: 'Point-virgule', description: 'Ce qu’Excel attend en français.', preview: 'date;montant\n2026-10-01;1 234,56' },
        { label: 'Virgule', description: 'Le standard du format.', preview: 'date,montant\n2026-10-01,1234.56' },
      ],
    },
    {
      question: 'Quelles colonnes ?',
      header: 'Colonnes',
      multiSelect: true,
      options: [
        { label: 'TVA', description: 'Le montant de la TVA.', preview: null },
        { label: 'Échéance', description: 'La date limite.', preview: null },
      ],
    },
  ],
}

function answered() {
  const decide = vi.fn<(card: Permission, decision: Decision) => void>()
  render(<DecisionCard card={card} busy={false} decide={decide} />)
  return decide
}

describe('Claude’s questions', () => {
  it('shows each option’s description, and the preview of the one hovered', () => {
    answered()
    expect(screen.getByText('Ce qu’Excel attend en français.')).toBeTruthy()
    expect(screen.getByText('Aperçu · Point-virgule')).toBeTruthy()
    fireEvent.mouseEnter(screen.getByText('Virgule').closest('label')!)
    expect(screen.getByText('Aperçu · Virgule')).toBeTruthy()
    expect(screen.getByText(/2026-10-01,1234\.56/)).toBeTruthy()
  })

  it('waits for an answer to each question, then sends the labels, the user’s own words and the note', () => {
    const decide = answered()
    const send = screen.getByRole('button', { name: 'Répondre' })
    expect(send.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Réponds aux 2 questions pour envoyer.')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: /Point-virgule/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /TVA/ }))
    // Writing one's own answer ticks « Autre », beside TVA (several choices).
    fireEvent.change(screen.getByRole('textbox', { name: 'Autre réponse à : Quelles colonnes ?' }), { target: { value: 'Client' } })
    fireEvent.click(screen.getAllByRole('button', { name: '+ Ajouter une précision pour Claude' })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: /Précision pour Claude/ }), { target: { value: 'Ouvert dans Excel' } })

    expect(screen.getByText('2 sur 2 répondues')).toBeTruthy()
    fireEvent.click(send)
    expect(decide).toHaveBeenCalledWith(card, {
      allow: true,
      answers: { 'Quel séparateur ?': 'Point-virgule', 'Quelles colonnes ?': 'TVA, Client' },
      notes: { 'Quel séparateur ?': 'Ouvert dans Excel' },
    })
  })

  it('« Autre » replaces the option of a single choice', () => {
    const decide = answered()
    fireEvent.click(screen.getByRole('radio', { name: /Virgule/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Autre réponse à : Quel séparateur ?' }), { target: { value: 'Barre verticale' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Échéance/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Répondre' }))
    expect(decide.mock.calls[0]?.[1].answers).toEqual({ 'Quel séparateur ?': 'Barre verticale', 'Quelles colonnes ?': 'Échéance' })
  })
})
