// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SidePanel, type CloseReason } from './panel.tsx'

afterEach(cleanup)

function Page({ onClose }: { onClose: (reason: CloseReason) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <button type="button" className="row-of-table">
        Une autre ligne
      </button>
      <button type="button">Ailleurs</button>
      {open && (
        <SidePanel
          title="feat/paiement"
          mono
          subtitle="shop · il y a 2 h"
          keys={[['Échap', 'fermer']]}
          keepOpenOn=".row-of-table"
          onClose={(reason) => {
            onClose(reason)
            setOpen(false)
          }}
        >
          <button type="button">Pousser</button>
        </SidePanel>
      )}
    </div>
  )
}

const panel = () => screen.queryByRole('complementary', { name: 'feat/paiement' })

describe('Panneau latéral', () => {
  it('closes by its × and gives the focus back to what opened it, without scrolling the page to it', () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Ouvrir' })
    opener.focus()
    fireEvent.click(opener)
    expect(panel()).not.toBeNull()
    expect(screen.getByText('Échap').tagName).toBe('KBD')
    const focus = vi.spyOn(opener, 'focus')
    fireEvent.click(screen.getByRole('button', { name: 'Fermer (Échap)' }))
    expect(onClose).toHaveBeenCalledWith('button')
    expect(panel()).toBeNull()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(opener)
  })

  it('closes by Escape from inside it, the same way', () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Ouvrir' })
    opener.focus()
    fireEvent.click(opener)
    const push = screen.getByRole('button', { name: 'Pousser' })
    push.focus()
    fireEvent.keyDown(push, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('key')
    expect(document.activeElement).toBe(opener)
  })

  it('closes by a click outside it, but not inside, on what keepOpenOn names, in a menu or while a dialog is open', () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Pousser' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Une autre ligne' }))
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.append(menu)
    fireEvent.pointerDown(menu)
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Ailleurs' }))
    expect(onClose).not.toHaveBeenCalled()
    dialog.remove()
    menu.remove()
    const elsewhere = screen.getByRole('button', { name: 'Ailleurs' })
    fireEvent.pointerDown(elsewhere)
    expect(onClose).toHaveBeenCalledWith('outside')
    expect(panel()).toBeNull()
  })
})
