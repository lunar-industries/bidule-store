// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Task } from '@bidule/sdk'
import { branchWords, findTasks, TaskField } from './tasks.tsx'

afterEach(cleanup)

const task = (id: string, title: string, more: Partial<Task> = {}) => ({ id, title, ref: null, status: 'À faire', ...more }) as Task
const tasks = [
  task('1', 'Page de paiement', { ref: 'TSK-301', status: 'Terminé' }),
  task('2', 'Écran de connexion', { ref: 'TSK-4' }),
  task('3', 'Paiement en 3 fois', { ref: 'TSK-398' }),
  task('4', 'Export des factures'),
]
const done = (t: Task) => t.status === 'Terminé'
const ids = (list: Task[]) => list.map((t) => t.id)

describe('Recherche d’une tâche', () => {
  it('finds every word in the title, the reference or more text, without accents, those not done first', () => {
    expect(ids(findTasks(tasks, 'ecran', { done }))).toEqual(['2'])
    expect(ids(findTasks(tasks, 'tsk-4', { done }))).toEqual(['2'])
    expect(ids(findTasks(tasks, 'paiement', { done }))).toEqual(['3', '1'])
    expect(ids(findTasks(tasks, 'paiement page', { done }))).toEqual(['1'])
    expect(ids(findTasks(tasks, 'feat', { done, also: (t) => (t.id === '4' ? 'feat/factures-pdf' : '') }))).toEqual(['4'])
    expect(ids(findTasks(tasks, '', { done, exclude: ['2', '3'] }))).toEqual(['4', '1'])
  })

  it('puts first the tasks sharing the most words with a branch’s name, its kind and its short words aside', () => {
    expect(branchWords('feat/TSK-142-export-csv')).toEqual(['tsk', '142', 'export', 'csv'])
    expect(ids(findTasks(tasks, '', { done, hint: 'feat/export-factures' }))[0]).toBe('4')
    expect(ids(findTasks(tasks, '', { done, hint: 'fix/tsk-398-paiement-3x' }))).toEqual(['3', '1', '2', '4'])
  })
})

describe('Champ de tâche', () => {
  it('shows the task chosen, lists every task on focus, and puts it back when left without a choice', () => {
    const onPick = vi.fn()
    render(<TaskField label="Tâche" tasks={tasks} done={done} value="TSK-4 · Écran de connexion" onPick={onPick} />)
    const input = screen.getByRole('combobox', { name: 'Tâche' }) as HTMLInputElement
    expect(input.value).toBe('TSK-4 · Écran de connexion')
    fireEvent.focus(input)
    expect(screen.getAllByRole('option')).toHaveLength(4)
    fireEvent.change(input, { target: { value: 'paie' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(tasks[0])
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.value).toBe('TSK-4 · Écran de connexion')
  })

  it('says why there is nothing to choose: no result, no module of tasks, a failed reading, a reading under way', () => {
    const { rerender } = render(<TaskField label="Tâche" tasks={tasks} done={done} onPick={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'paiment' } })
    expect(screen.getByRole('status').textContent).toBe('Aucune tâche ne correspond à « paiment ».')
    rerender(<TaskField label="Tâche" tasks={[]} problem={{ kind: 'none' }} done={done} onPick={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(/^Aucun module de tâches actif/)
    expect(screen.getByRole('button', { name: 'Réglages › Extensions' })).toBeDefined()
    const retry = vi.fn()
    rerender(<TaskField label="Tâche" tasks={[]} problem={{ kind: 'failed', message: 'Notion ne répond pas.' }} retry={retry} done={done} onPick={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(/Les tâches n’ont pas pu être lues : Notion ne répond pas\./)
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(retry).toHaveBeenCalled()
    rerender(<TaskField label="Tâche" tasks={null} done={done} onPick={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toBe('Lecture des tâches…')
  })

  it('inline: always open, empty after a choice, Escape cancels without reaching what is around it', () => {
    const onCancel = vi.fn()
    const around = vi.fn()
    const onPick = vi.fn()
    render(
      <div onKeyDown={around}>
        <TaskField label="Tâche de feat/x" hideLabel inline tasks={tasks} done={done} onPick={onPick} onCancel={onCancel} />
      </div>,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(screen.getAllByRole('option')).toHaveLength(4)
    fireEvent.change(input, { target: { value: 'export' } })
    fireEvent.mouseDown(screen.getByRole('option'))
    expect(onPick).toHaveBeenCalledWith(tasks[3])
    expect(input.value).toBe('')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(around).not.toHaveBeenCalled()
  })
})
