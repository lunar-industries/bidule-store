import { Modal, openDialog } from '@bidule/sdk'
import './common.css'

export type Ask = {
  // A question: « Fusionner la MR !38 ? ».
  title: string
  // What is going to happen, in a full sentence.
  text: string
  // The action's button: « Fusionner ».
  action: string
  // A write that loses something (removing, dropping changes, stopping Claude at work): the focus starts on
  // « Annuler » and the action is drawn in red, so that one Enter too many destroys nothing.
  danger?: boolean
}

/**
 * The confirmation before a write, the same in every Lunar Industries module: resolves to the answer. An ordinary
 * write has the focus on its action, so that Enter confirms; Escape cancels. The module still decides when to ask.
 */
export function confirm(ask: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog((close) => {
      const answer = (yes: boolean) => {
        close()
        resolve(yes)
      }
      return (
        <Modal label={ask.title} onClose={() => answer(false)}>
          <h2>{ask.title}</h2>
          <p>{ask.text}</p>
          <div className="row">
            <span className="grow" />
            <button type="button" className="btn" autoFocus={ask.danger} onClick={() => answer(false)}>
              Annuler
            </button>
            {ask.danger ? (
              <button type="button" className="btn lunar-danger" onClick={() => answer(true)}>
                {ask.action}
              </button>
            ) : (
              <button type="button" className="btn-cta" autoFocus onClick={() => answer(true)}>
                {ask.action}
              </button>
            )}
          </div>
        </Modal>
      )
    })
  })
}
