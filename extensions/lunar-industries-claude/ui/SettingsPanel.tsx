import { useEffect, useState } from 'react'
import { execute, react, saveSettingValues, useSettingValues } from '@bidule/sdk'
import type { ClaudePlace, RepoOverrides, RepoSettings } from '../contract.ts'
import { api, errorMessage } from './api.ts'
import { ChipField } from './ChipField.tsx'
import { Places } from './ClaudePage.tsx'
import { useEnabled } from './state.ts'

const REPOS = 'lunar-industries-claude.repos'

// The values of the two settings drawn as chips (see bidule.json: `hidden`, since they are not written as text here).
const SOURCES = [
  { value: 'user', label: 'Les miens (~/.claude)' },
  { value: 'project', label: 'Ceux du dépôt' },
  { value: 'local', label: 'Ceux du dépôt propres à ce poste' },
]
const NOTIFICATIONS = [
  { value: 'decision', label: 'Claude attend une décision' },
  { value: 'turn', label: 'Claude a terminé' },
  { value: 'error', label: 'Session Claude en erreur' },
  { value: 'slot', label: 'Créneau exécutable pris' },
]

// A repo's own settings as the panel asks them: the module's (empty: the module's, above), and its review target,
// which lunar-industries-common keeps for every module (empty: the one of Réglages › Lunar Industries - Commun).
type RepoFields = RepoOverrides & { reviewTarget?: string }
const FIELDS: { key: keyof RepoFields; title: string; placeholder?: string; hint?: string }[] = [
  {
    key: 'reviewTarget',
    title: 'Branche cible des MR',
    placeholder: 'develop',
    hint: 'La même que dans la page Branches. Vide : celle de Réglages › Lunar Industries - Commun.',
  },
  { key: 'stagingBranch', title: 'Branche de staging' },
  { key: 'productionBranch', title: 'Branche de production' },
  { key: 'stagingJob', title: 'Job de staging', hint: '{env} : l’environnement.' },
  { key: 'productionJob', title: 'Job de production' },
  { key: 'stagingEnv', title: 'Environnement de staging' },
  {
    key: 'worktreeSeed',
    title: 'Fichiers recopiés dans un worktree',
    placeholder: '.env, config/*.local.yml',
    hint: 'Non suivis par git, relatifs au dépôt.',
  },
  { key: 'worktreePrepare', title: 'Préparation d’un worktree', placeholder: 'npm ci' },
]

// The overrides kept in the hidden setting, by repo path.
function overridesOf(raw: unknown): Record<string, RepoOverrides> {
  try {
    const parsed: Record<string, RepoOverrides> | null = JSON.parse(String(raw ?? '{}'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Under the module's settings: the Claude Code the sessions run (found, logged in), and each repo's own settings for
 * the sessions and their tools (Simon's Réglages › Claude), kept in the hidden setting `lunar-industries-claude.repos`.
 */
export function SettingsPanel() {
  const enabled = useEnabled()
  const [places, setPlaces] = useState<ClaudePlace[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [repos, setRepos] = useState<RepoSettings[] | null>(null)
  const [reposError, setReposError] = useState<string | null>(null)

  const check = async () => {
    setChecking(true)
    try {
      setPlaces((await api.status()).places)
    } catch (err) {
      setPlaces([])
      react('panic', errorMessage(err), errorMessage(err))
    } finally {
      setChecking(false)
    }
  }
  const loadRepos = () =>
    api.repos().then(
      (r) => setRepos(r.repos),
      (err) => setReposError(errorMessage(err)),
    )
  useEffect(() => {
    if (!enabled) return
    void check()
    void loadRepos()
  }, [enabled])

  if (!enabled) return <p className="legend">Allume les sessions pour vérifier Claude Code et régler chaque dépôt.</p>

  return (
    <>
      <div className="fields">
        <ChipField
          settingKey="lunar-industries-claude.settingSources"
          label="Réglages chargés par une session"
          choices={SOURCES}
          fallback="user, project, local"
          hint="Réglages, hooks, skills et CLAUDE.md, comme dans le terminal. Les skills de l’application sont toujours chargés."
        />
        <ChipField
          settingKey="lunar-industries-claude.notify"
          label="Me prévenir par une notification du système"
          choices={NOTIFICATIONS}
          fallback="decision, error, slot"
          hint="Seulement quand la fenêtre n’est pas au premier plan."
        />
      </div>
      <section className="lc-settings-block" aria-labelledby="lc-settings-places">
        <div className="row">
          <h3 id="lc-settings-places" className="grow">
            Claude Code
          </h3>
          <button type="button" className="btn lc-btn-sm" disabled={checking} onClick={() => void check()}>
            {checking ? 'Vérification…' : 'Vérifier'}
          </button>
        </div>
        <Places places={places} checking={checking} />
      </section>
      <section className="lc-settings-block" aria-labelledby="lc-settings-repos">
        <h3 id="lc-settings-repos">Par dépôt</h3>
        <p className="legend">Vide : le réglage du module, plus haut.</p>
        {reposError && <p className="test-result bad">{reposError}</p>}
        {repos?.map((r) => <RepoForm key={r.path} repo={r} onSaved={() => void loadRepos()} />)}
        {repos && !repos.length && <p className="legend">Aucun dépôt connu.</p>}
      </section>
    </>
  )
}

// `onSaved`: the repos are read again (their review target is lunar-industries-common's, not in this module's setting).
function RepoForm({ repo, onSaved }: { repo: RepoSettings; onSaved: () => void }) {
  const values = useSettingValues()
  const saved: RepoFields = { ...overridesOf(values?.[REPOS])[repo.path], reviewTarget: repo.reviewTarget ?? '' }
  const [draft, setDraft] = useState<RepoFields | null>(null)
  const [saving, setSaving] = useState(false)
  const shown = draft ?? saved

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const { reviewTarget, ...own } = draft
      const all = overridesOf(values?.[REPOS])
      const kept = Object.fromEntries(Object.entries(own).filter(([, v]) => typeof v === 'string' && v.trim()))
      if (Object.keys(kept).length) all[repo.path] = kept
      else delete all[repo.path]
      await saveSettingValues({ [REPOS]: JSON.stringify(all) })
      const target = reviewTarget?.trim() || null
      if (target !== repo.reviewTarget) await execute('lunar-industries-common.setTarget', { repo: repo.path, target })
      setDraft(null)
      onSaved()
      react('quack', `Réglages de ${repo.label} enregistrés, coin !`, `${repo.label} réglé`)
    } catch (err) {
      react('panic', errorMessage(err), errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const count = FIELDS.filter((f) => saved[f.key]).length
  return (
    <details className="lc-disclosure lc-repo">
      <summary className="row">
        <strong className="grow ellipsis">{repo.label}</strong>
        {count > 0 && <span className="legend">{count} réglage{count > 1 ? 's' : ''}</span>}
      </summary>
      <form
        className="lc-repo-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="legend mono ellipsis" title={repo.path}>
          {repo.path}
        </p>
        <div className="fields">
          {FIELDS.map((f) => (
            <label key={f.key} className="field">
              {f.title}
              <input
                value={shown[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setDraft({ ...shown, [f.key]: e.target.value })}
              />
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
        </div>
        <div className="row">
          <span className="grow" />
          {draft && (
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Annuler
            </button>
          )}
          <button type="submit" className="btn" disabled={!draft || saving}>
            Enregistrer
          </button>
        </div>
      </form>
    </details>
  )
}
