// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useDialogs } from '@bidule/sdk'
import { confirm } from './confirm.tsx'
import { Alert, Empty, Loading } from './states.tsx'

afterEach(cleanup)

// Where the core draws the dialogs.
function Dialogs() {
  return (
    <>
      {useDialogs().map((d) => (
        <div key={d.key}>{d.node}</div>
      ))}
    </>
  )
}

describe('Confirmation', () => {
  it('an ordinary write: the focus on its action, which answers yes', async () => {
    render(<Dialogs />)
    let answer: Promise<boolean> = Promise.resolve(false)
    act(() => {
      answer = confirm({ title: 'Fusionner la MR !38 ?', text: 'La branche part dans develop.', action: 'Fusionner' })
    })
    const action = screen.getByRole('button', { name: 'Fusionner' })
    expect(document.activeElement).toBe(action)
    expect(action.className).toBe('btn-cta')
    act(() => fireEvent.click(action))
    expect(await answer).toBe(true)
  })

  it('a write that loses something: the focus on « Annuler », the action in red', async () => {
    render(<Dialogs />)
    let answer: Promise<boolean> = Promise.resolve(true)
    act(() => {
      answer = confirm({ title: 'Supprimer api-db ?', text: 'Le conteneur est perdu.', action: 'Supprimer', danger: true })
    })
    expect(document.activeElement?.textContent).toBe('Annuler')
    expect(screen.getByRole('button', { name: 'Supprimer' }).className).toBe('btn lunar-danger')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Annuler' })))
    expect(await answer).toBe(false)
  })
})

describe('Lecture, échec, rien à montrer', () => {
  it('says each as such to a screen reader', () => {
    render(
      <>
        <Alert retry={() => undefined}>Les branches n’ont pas pu être relues.</Alert>
        <Loading lines={3}>Lecture des dépôts…</Loading>
        <Empty title="Les sessions n’ont pas pu être lues." failed action={{ label: 'Réessayer', run: () => undefined }}>
          L’API ne répond pas.
        </Empty>
      </>,
    )
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toBe('Lecture des dépôts…')
    expect(screen.getAllByRole('button', { name: 'Réessayer' })).toHaveLength(2)
  })
})
