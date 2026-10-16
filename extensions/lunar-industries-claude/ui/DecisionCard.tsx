import { useId, useState } from 'react'
import type { Decision, Question } from '../contract.ts'
import { cardTitle, type DecisionEvent, type Permission } from './events.ts'
import { md } from './markdown.ts'

// A card already answered: what was decided, in a line.
export function Decided({ card, decision }: { card: Permission; decision: DecisionEvent }) {
  return (
    <div className="row lc-decided">
      <span className={`tag lunar-tone-${decision.allow ? 'ok' : 'bad'}`}>
        {decision.always ? 'Autorisé pour la session' : decision.allow ? 'Autorisé' : 'Refusé'}
      </span>
      <span className="mono ellipsis grow">{card.ask === 'plan' ? 'Plan' : card.detail}</span>
      {decision.answer && <span className="legend ellipsis">{decision.answer}</span>}
    </div>
  )
}

/**
 * What Claude waits for (Simon's decision cards): a tool's permission, a plan to validate (refused with an
 * instruction), or its questions.
 */
export function DecisionCard({
  card,
  busy,
  decide,
}: {
  card: Permission
  busy: boolean
  decide: (card: Permission, decision: Decision) => void
}) {
  const [instruction, setInstruction] = useState('')

  if (card.ask === 'plan')
    return (
      <div className="lc-card" role="group" aria-label="Claude propose un plan">
        <strong>Claude propose un plan</strong>
        <div className="lc-text lc-plan selectable" dangerouslySetInnerHTML={{ __html: md(card.plan ?? 'Le plan est dans le message au-dessus.') }} />
        <label className="field wide">
          Pour le refuser, dis à Claude quoi changer
          <textarea className="lc-textarea" rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </label>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy || !instruction.trim()}
            onClick={() => decide(card, { allow: false, message: instruction.trim() })}
          >
            Refuser avec cette consigne
          </button>
          <span className="grow" />
          <button type="button" className="btn-cta" disabled={busy} onClick={() => decide(card, { allow: true })}>
            Valider le plan
          </button>
        </div>
      </div>
    )

  if (card.ask === 'question') return <Questions card={card} busy={busy} decide={decide} />

  return (
    <div className="lc-card" role="group" aria-label={cardTitle(card)}>
      <strong>{cardTitle(card)}</strong>
      <pre className="mono lc-command selectable">{card.detail}</pre>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => decide(card, { allow: false })}>
          Refuser
        </button>
        {card.canAlways && (
          <button type="button" className="btn" disabled={busy} onClick={() => decide(card, { allow: true, always: true })}>
            Toujours pour cette session
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn-cta" disabled={busy} onClick={() => decide(card, { allow: true })}>
          Autoriser
        </button>
      </div>
    </div>
  )
}

// What the user did with a question: the options ticked, their own answer (« Autre »), the note for Claude, and the
// option whose preview is shown (hovered or focused).
type Answer = { chosen: string[]; other: boolean; text: string; note: string; noting: boolean; shown: string | null }
const EMPTY: Answer = { chosen: [], other: false, text: '', note: '', noting: false, shown: null }

// The answer Claude reads: the labels ticked, then the user's own words, joined by « , ».
const answerOf = (a: Answer) => [...a.chosen, ...(a.other && a.text.trim() ? [a.text.trim()] : [])].join(', ')

/**
 * Claude's questions (AskUserQuestion), one after the other in the card: each option a whole row with its
 * description, a round mark for one choice and a box for several; its preview beside the options, following the one
 * hovered or focused; « Autre » for the user's own answer; a note for Claude. « Répondre » once each has an answer.
 */
function Questions({ card, busy, decide }: { card: Permission; busy: boolean; decide: (card: Permission, decision: Decision) => void }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const of = (q: Question) => answers[q.question] ?? EMPTY
  const set = (q: Question, change: Partial<Answer>) => setAnswers((all) => ({ ...all, [q.question]: { ...(all[q.question] ?? EMPTY), ...change } }))
  const done = card.questions.filter((q) => answerOf(of(q))).length
  const count = card.questions.length
  const send = () =>
    decide(card, {
      allow: true,
      answers: Object.fromEntries(card.questions.map((q) => [q.question, answerOf(of(q))])),
      notes: Object.fromEntries(card.questions.flatMap((q) => (of(q).note.trim() ? [[q.question, of(q).note.trim()]] : []))),
    })
  const title = count > 1 ? `Claude pose ${count} questions` : 'Claude pose une question'
  return (
    <div className="lc-card lc-questions" role="group" aria-label={title}>
      <div className="row">
        <strong className="grow">{title}</strong>
        {count > 1 && (
          <span className="legend" aria-live="polite">
            {done} sur {count} répondue{done > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {card.questions.map((q) => (
        <QuestionField key={q.question} question={q} answer={of(q)} change={(c) => set(q, c)} />
      ))}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => decide(card, { allow: false })}>
          Ne pas répondre
        </button>
        <span className="grow legend lc-questions-left">
          {done < count ? (count > 1 ? `Réponds aux ${count} questions pour envoyer.` : 'Choisis une réponse pour envoyer.') : ''}
        </span>
        <button type="button" className="btn-cta" disabled={busy || done < count} onClick={send}>
          Répondre
        </button>
      </div>
    </div>
  )
}

function QuestionField({ question: q, answer: a, change }: { question: Question; answer: Answer; change: (c: Partial<Answer>) => void }) {
  const id = useId()
  const type = q.multiSelect ? 'checkbox' : 'radio'
  const pick = (label: string, on: boolean) =>
    change(
      q.multiSelect
        ? { chosen: on ? [...a.chosen, label] : a.chosen.filter((l) => l !== label) }
        : { chosen: on ? [label] : [], other: false }
    )
  const withPreview = q.options.some((o) => o.preview)
  const previewed = q.options.find((o) => o.label === (a.shown ?? a.chosen[0])) ?? q.options.find((o) => o.preview)
  const options = (
    <div className="lc-options" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
      {q.options.map((o) => {
        const on = a.chosen.includes(o.label)
        return (
          <label
            key={o.label}
            className="lc-option"
            data-checked={on}
            onMouseEnter={() => o.preview && change({ shown: o.label })}
            onFocus={() => o.preview && change({ shown: o.label })}
          >
            <input
              type={type}
              name={id}
              checked={on}
              aria-describedby={o.preview ? `${id}-preview` : undefined}
              onChange={(e) => pick(o.label, e.target.checked)}
            />
            <span className="lc-option-text">
              <strong>{o.label}</strong>
              {o.description && <span>{o.description}</span>}
            </span>
          </label>
        )
      })}
      <label className="lc-option other" data-checked={a.other}>
        <input
          type={type}
          name={id}
          checked={a.other}
          onChange={(e) => change(q.multiSelect ? { other: e.target.checked } : { other: e.target.checked, chosen: [] })}
        />
        <strong>Autre :</strong>
        <input
          type="text"
          className="lc-option-input"
          aria-label={`Autre réponse à : ${q.question}`}
          placeholder="Ta propre réponse"
          value={a.text}
          // Writing one's own answer chooses it.
          onChange={(e) => change(q.multiSelect ? { text: e.target.value, other: true } : { text: e.target.value, other: true, chosen: [] })}
        />
      </label>
    </div>
  )
  return (
    <fieldset className="lc-question">
      <legend className="row">
        {q.header && <span className="tag lunar-tone-neutral">{q.header}</span>}
        <span>{q.question}</span>
        {q.multiSelect && <span className="legend">plusieurs choix possibles</span>}
      </legend>
      {withPreview ? (
        <div className="lc-question-split">
          {options}
          <figure className="lc-preview" id={`${id}-preview`}>
            <figcaption className="legend">Aperçu · {previewed?.label}</figcaption>
            <pre className="mono selectable">{previewed?.preview ?? 'Cette option n’a pas d’aperçu.'}</pre>
          </figure>
        </div>
      ) : (
        options
      )}
      {a.noting ? (
        <label className="field wide">
          Précision pour Claude (facultatif)
          <textarea className="lc-textarea" rows={2} value={a.note} autoFocus onChange={(e) => change({ note: e.target.value })} />
        </label>
      ) : (
        <button type="button" className="lc-add-note" onClick={() => change({ noting: true })}>
          + Ajouter une précision pour Claude
        </button>
      )}
    </fieldset>
  )
}
