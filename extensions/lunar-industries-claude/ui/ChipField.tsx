import { saveSettingValues, useSettingValues } from '@bidule/sdk'

type Choice = { value: string; label: string }

/**
 * A setting kept as a comma-separated list, drawn as chips to tick (the settings page has no field of its own for
 * several values among fixed ones): one chip a value, pressed when the list holds it.
 */
export function ChipField({
  settingKey,
  label,
  choices,
  fallback,
  hint,
  count,
}: {
  settingKey: string
  label: string
  choices: Choice[]
  // What the list holds while the setting has never been saved.
  fallback: string
  hint?: string
  count?: (n: number) => string
}) {
  const values = useSettingValues()
  if (!values) return null
  const checked = new Set(
    String(values[settingKey] ?? fallback)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  const toggle = (value: string) => {
    const next = new Set(checked)
    if (!next.delete(value)) next.add(value)
    // In the order of the choices, so that the saved text does not depend on the order of the clicks.
    void saveSettingValues({ [settingKey]: choices.filter((c) => next.has(c.value)).map((c) => c.value).join(', ') })
  }
  return (
    <div className="field wide">
      {label}
      <div className="row lc-chips" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
        {choices.map((c) => (
          <button key={c.value} type="button" className="chip-btn" aria-pressed={checked.has(c.value)} onClick={() => toggle(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {count && <span className="hint muted">{count(checked.size)}</span>}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
