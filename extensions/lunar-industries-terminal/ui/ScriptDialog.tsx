import { errorMessage, Modal, openDialog, react, savedState, useSavedState } from '@bidule/sdk'
import { useId, useState } from 'react'
import {
  buildArgv,
  filterChoices,
  initialValues,
  paramProblems,
  pickAll,
  pickNone,
  previewParts,
  shownArgv,
  type FileParam,
  type ScriptValue,
  type ScriptValues,
} from '../scripts-file.ts'
import { keptKey, keptValues, rememberValues, type KeptValues } from './kept.ts'
import { runFileScript, type FileScriptView } from './script-commands.ts'
import type { TerminalTabs } from './tabs.ts'

// A single choice among this many values at most is a segmented control; up to CHIPS_MAX, pills; beyond, a select.
const SEGMENTED_MAX = 5
const CHIPS_MAX = 16
// A multiple choice offers a filter beyond this many values.
const FILTER_FROM = 12

// The values last used for each script, per repo: given again when its form opens. Kept by the API (kept.ts).
const KEPT = 'lunar-industries-terminal.scriptValues'
const NOTHING_KEPT: KeptValues = {}

type Repo = { path: string; label: string }

// A script of `bidule.scripts.json`: at once when it has no parameter, else through its form, with the values it was
// last launched with.
export function startFileScript(terminals: TerminalTabs, repo: Repo, script: FileScriptView): void {
  if (!script.order.length) return void runFileScript(terminals, repo.path, script.name, {})
  savedState(KEPT, NOTHING_KEPT, keptValues).then(
    (kept) => {
      const last = kept[keptKey(repo.path, script.name)] ?? null
      openDialog((close) => <ScriptDialog terminals={terminals} repo={repo} script={script} last={last} close={close} />)
    },
    (err: unknown) => {
      const message = errorMessage(err)
      react('panic', message, message)
    },
  )
}

// Whether a parameter's control is one element its label can point at (a field, a select, a box, the filter), rather
// than a group of buttons (which a click on the label would press).
function labelled(param: FileParam, choices: string[]): boolean {
  if (param.type !== 'choice') return true
  if (param.multiple) return choices.length > FILTER_FROM
  return choices.length > CHIPS_MAX
}

/**
 * The form of a script with parameters: a label on the left, its control on the right (one column when narrow), the
 * command as it will run below, its parameters' arguments highlighted. Enter in a field or Ctrl+Enter anywhere runs it;
 * a missing value is said under its control once touched or after a try.
 */
function ScriptDialog({
  terminals,
  repo,
  script,
  last,
  close,
}: {
  terminals: TerminalTabs
  repo: Repo
  script: FileScriptView
  last: ScriptValues | null
  close: () => void
}) {
  const [values, setValues] = useState<ScriptValues>(() => initialValues(script, last))
  const [, keep] = useSavedState(KEPT, NOTHING_KEPT, keptValues)
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [tried, setTried] = useState(false)
  const [running, setRunning] = useState(false)
  const id = useId()
  const set = (key: string, value: ScriptValue) => {
    setValues((v) => ({ ...v, [key]: value }))
    setTouched((t) => (t.has(key) ? t : new Set([...t, key])))
  }

  const problems = paramProblems(script, values, script.choices)
  const blocked = Object.keys(problems).length > 0
  const parts = previewParts(script, values, script.choices)

  const launch = async () => {
    setTried(true)
    if (blocked || running) return
    setRunning(true)
    keep((kept) => rememberValues(kept, repo.path, script.name, values))
    if (await runFileScript(terminals, repo.path, script.name, values)) close()
    else setRunning(false)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shownArgv(buildArgv(script, values, script.choices)))
      react('quack', 'Commande copiée. Coin.', 'Commande copiée')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      react('panic', message, message)
    }
  }

  // The file's defaults, not the values last used.
  const reset = () => {
    setValues(initialValues(script, null))
    setTouched(new Set())
    setTried(false)
  }

  return (
    <Modal label={script.title} onClose={close}>
      <form
        className="lterm-script-form"
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void launch()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void launch()
          }
        }}
      >
        <header className="lterm-script-head">
          <div className="row">
            <h2 className="grow">{script.title}</h2>
            <span className="legend">{repo.label}</span>
          </div>
          {script.description && <p className="muted">{script.description}</p>}
        </header>

        <div className="lterm-script-params">
          {script.order.map((key, i) => {
            const param = script.params[key]
            const choices = script.choices[key] ?? []
            const error = (tried || touched.has(key)) && problems[key] ? problems[key] : null
            return (
              <div key={key} className="lterm-script-param">
                <label className="lterm-script-label" id={`${id}-${key}-label`} htmlFor={labelled(param, choices) ? `${id}-${key}` : undefined}>
                  <span>{param.label}</span>
                  <span className={`lterm-script-mark${param.required ? ' required' : ''}`}>{param.required ? 'requis' : 'facultatif'}</span>
                </label>
                <div className="lterm-script-control">
                  <Param
                    id={`${id}-${key}`}
                    labelId={`${id}-${key}-label`}
                    param={param}
                    choices={choices}
                    value={values[key]}
                    first={i === 0}
                    invalid={Boolean(error)}
                    set={(v) => set(key, v)}
                  />
                  {error && <span className="lterm-script-error">{error}</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="lterm-script-preview">
          <span className="legend">Commande</span>
          {/* The copy button sits inside the box, at its end: a long command wraps before it, never under it. */}
          <div className="lterm-script-command">
            <code className="mono">
              {parts.map((p, i) => (
                <span key={i}>
                  {i > 0 && ' '}
                  <span className={p.param ? `lterm-script-arg${p.missing ? ' missing' : ''}` : undefined}>{p.text}</span>
                </span>
              ))}
            </code>
            <button
              type="button"
              className="icon-btn lterm-script-copy"
              aria-label="Copier la commande"
              title="Copier la commande"
              disabled={blocked}
              onClick={() => void copy()}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
              </svg>
            </button>
          </div>
        </div>

        <div className="row">
          <button type="button" className="btn" title="Les valeurs par défaut du fichier" onClick={reset}>
            Réinitialiser
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={close}>
            Annuler
          </button>
          {/* Pressed while something is missing, it says what under each control. */}
          <button type="submit" className="btn-cta" disabled={running} aria-disabled={blocked}>
            Lancer
          </button>
        </div>
      </form>
    </Modal>
  )
}

type ParamProps = {
  id: string
  labelId: string
  param: FileParam
  choices: string[]
  value: ScriptValue | undefined
  first: boolean
  invalid: boolean
  set: (v: ScriptValue) => void
}

function Param({ id, labelId, param, choices, value, first, invalid, set }: ParamProps) {
  if (param.type === 'flag') {
    return (
      <span className="lterm-script-check">
        <input id={id} type="checkbox" autoFocus={first} checked={value === true} onChange={(e) => set(e.target.checked)} />
        {param.value && <code className="mono muted">{param.value}</code>}
      </span>
    )
  }
  if (param.type === 'choice' && param.multiple) {
    return <MultipleChoice id={id} labelId={labelId} choices={choices} value={value} first={first} set={set} />
  }
  if (param.type === 'choice') {
    const current = typeof value === 'string' ? value : ''
    if (!choices.length) return <span className="hint muted">Aucun choix possible.</span>
    // Optional: a second click on the pressed value lets it go.
    const pick = (c: string) => set(current === c && !param.required ? '' : c)
    if (choices.length <= SEGMENTED_MAX) {
      return (
        <div className="segmented" role="group" aria-labelledby={labelId}>
          {choices.map((c, i) => (
            <button key={c} type="button" autoFocus={first && i === 0} aria-pressed={current === c} onClick={() => pick(c)}>
              {c}
            </button>
          ))}
        </div>
      )
    }
    if (choices.length <= CHIPS_MAX) {
      return (
        <div className="lterm-script-chips" role="group" aria-labelledby={labelId}>
          {choices.map((c, i) => (
            <Chip key={c} first={first && i === 0} pressed={current === c} onClick={() => pick(c)}>
              {c}
            </Chip>
          ))}
        </div>
      )
    }
    return (
      <div className="field">
        <select id={id} autoFocus={first} value={current} aria-invalid={invalid} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    )
  }
  return (
    <div className="field">
      <input
        id={id}
        className="mono"
        autoFocus={first}
        value={typeof value === 'string' ? value : ''}
        placeholder={param.placeholder}
        aria-invalid={invalid}
        onChange={(e) => set(e.target.value)}
      />
      {param.type === 'args' && <span className="hint muted">Plusieurs arguments, séparés par des espaces ; guillemets possibles.</span>}
    </div>
  )
}

type MultipleProps = { id: string; labelId: string; choices: string[]; value: ScriptValue | undefined; first: boolean; set: (v: ScriptValue) => void }

// Several values: pills to toggle, « Tout » / « Aucun » for those shown, and a filter when there are many.
function MultipleChoice({ id, labelId, choices, value, first, set }: MultipleProps) {
  const [filter, setFilter] = useState('')
  const picked = Array.isArray(value) ? value : []
  if (!choices.length) return <span className="hint muted">Aucun choix possible.</span>
  const filtered = choices.length > FILTER_FROM
  const shown = filtered ? filterChoices(choices, filter) : choices
  return (
    <div className="lterm-script-multiple">
      <div className="row lterm-script-bulk">
        {filtered && (
          <input
            id={id}
            className="lterm-script-filter"
            type="search"
            autoFocus={first}
            placeholder={`Filtrer ${choices.length} choix…`}
            value={filter}
            // Enter in the filter ticks the only value left, rather than running the script.
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return
              e.preventDefault()
              if (shown.length === 1) set(pickAll(picked, shown))
            }}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        <span className="grow legend">
          {picked.length} sur {choices.length}
        </span>
        <button type="button" className="lterm-script-link" disabled={!shown.length} onClick={() => set(pickAll(picked, shown))}>
          Tout
        </button>
        <button type="button" className="lterm-script-link" disabled={!picked.length} onClick={() => set(pickNone(picked, shown))}>
          Aucun
        </button>
      </div>
      <div className="lterm-script-chips" role="group" aria-labelledby={labelId}>
        {shown.map((c, i) => (
          <Chip
            key={c}
            first={first && !filtered && i === 0}
            pressed={picked.includes(c)}
            onClick={() => set(picked.includes(c) ? pickNone(picked, [c]) : pickAll(picked, [c]))}
          >
            {c}
          </Chip>
        ))}
        {!shown.length && <span className="hint muted">Aucun choix ne correspond.</span>}
      </div>
    </div>
  )
}

// A value to toggle: a tick when pressed, beside the pill's own pressed background.
function Chip({ first, pressed, onClick, children }: { first: boolean; pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className="chip-btn" autoFocus={first} aria-pressed={pressed} onClick={onClick}>
      <span className="lterm-script-tick" aria-hidden="true">
        {pressed ? '✓' : ''}
      </span>
      <span className="mono">{children}</span>
    </button>
  )
}
