# Claude (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module. Sa page est `/lunar-industries/claude`, reprise de la page Claude de
quack-board (Simon) et dessinée d'après la maquette « Claude Lunar » (Claude Design). Le module est éteint tant que
l'interrupteur expérimental de ses réglages ne l'allume pas.

## Le serveur (`server/`)

Les sessions de Claude Code tournent par l'Agent SDK (`sessions.ts`, `runner.ts`), dans des worktrees à part
(`worktrees.ts`), avec les outils de l'app (serveur MCP « workspace », `tools.ts`). Une session du terminal est lue
depuis sa transcription (`transcript.ts`) et suivie tant que la page la montre. Les routes sont listées dans
`contract.ts`.

Une question de Claude (AskUserQuestion) garde, pour chaque option, son libellé, sa description et son aperçu
(`preview`, null sans aperçu). La réponse (`Decision`) porte les libellés choisis, ou le texte de l'utilisateur
(« Autre »), et ses précisions (`notes`) : le serveur les renvoie au SDK dans `answers` et `annotations` (la précision,
et l'aperçu de l'option choisie, `annotationsOf`).

## La page (`ui/ClaudePage.tsx`)

- **Dans la barre de l'espace** (`SpaceTools`, page `fill with-tools`) : la recherche (`ToolSearch`, `/` y va) et « Nouvelle
  session ».
- **La liste** à gauche : « En attente de toi » d'abord, puis les autres sessions ; les archivées à la demande. Le clic
  droit, la touche Menu ou Maj+F10 ouvrent le menu de la session (le menu commun de `lunar-industries-common`), le même
  que son « ⋯ » : « Ouvrir la tâche », « Copier l'identifiant de la session », « Archiver » (éteint, avec la raison en
  infobulle, tant que la session tourne dans l'app).
- **Les colonnes** se replient en bandes (le nom de chaque point dit l'état de sa session). Le choix, et les archivées
  montrées, sont gardés d'un lancement à l'autre (`useSavedState`, réglage caché `lunar-industries-claude.columns`).
  Une fenêtre de moins de 1 000 px replie les deux ; une colonne dépliée à
  la main le reste jusqu'à la prochaine fois, sans toucher au choix gardé.
- **La conversation** (`ui/Conversation.tsx`) : le fil (`role="log"`, `aria-live="polite"`), « Interrompre » et
  « Arrêter… » avec leur infobulle (dans le « ⋯ » sous 1 000 px) ; « Arrêter » demande confirmation quand Claude
  travaille. Le champ : Entrée envoie, Maj+Entrée va à la ligne, Échap interrompt, ↑ ↓ reprennent un message envoyé,
  Maj+Tab change de mode de permission seulement quand il est vide. Les outils ont un nom lisible (`toolLabel` de
  `ui/events.ts`) ; un message inconnu du SDK ne montre jamais son type brut.
- **Les cartes de décision** (`ui/DecisionCard.tsx`) : une permission, un plan, ou les questions de Claude. Chaque
  option d'une question est une ligne entière avec sa description (un rond pour un choix, une case pour plusieurs) ;
  l'aperçu des options s'affiche à côté et suit l'option survolée ou choisie ; « Autre » donne un champ ; « + Ajouter
  une précision pour Claude » un texte ; « Répondre » attend une réponse à chaque question.
- **Le contexte** à droite (`ui/SessionContext.tsx`) : la tâche (« Changer de tâche… » et « Rattacher à une tâche… »
  ouvrent `pickTask` de `lunar-industries-common` : rien n'est rattaché avant d'avoir validé, et une lecture des tâches
  qui échoue y est dite), les worktrees, les fichiers modifiés, le créneau exécutable, la session et ses tokens.
- **Les échecs** ne passent jamais pour du vide : une liste illisible, un contexte illisible ou une vérification de
  Claude Code qui échoue sont dits (`Alert` et `Empty` communs), avec Réessayer.
- **Les composants communs** (`lunar-industries-common`) : les menus « Ajouter » et « Commandes et skills » sont le
  menu commun, ouvert au-dessus de son bouton (les commandes avec leur description, `wide`) ; « Arrêter » pendant que
  Claude travaille est la confirmation commune, le focus sur « Annuler » ; les icônes et les teintes des étiquettes
  sont les communes. Une revue s'appelle MR sur GitLab et PR sur GitHub.
- **La première visite** : les vérifications et les tâches en cours, sur une colonne sous 1 000 px.

Ce qui se calcule sans rien dessiner est dans `ui/events.ts` et `ui/models.ts`, testé dans `ui/events.test.ts` ; la
carte des questions est essayée dans `ui/DecisionCard.test.tsx`.

## Classes CSS

Toutes dans `ui/claude.css`, sous `lc-` :

- Communes : `lc-icon-sm`, `lc-icon-xs`, `lc-select`, `lc-textarea`, `lc-disclosure`, `lc-error`.
- La page : `lc-page`, `lc-none`, `lc-list`, `lc-groups`, `lc-group`, `lc-group-title`, `lc-item`, `lc-item-text`,
  `lc-when`, `lc-archived`, `lc-rail`, `lc-rail-item`, `lc-dot`.
- La conversation : `lc-conv` (`wide`), `lc-conv-head`, `lc-conv-title`, `lc-conv-title-line`, `lc-conv-ref`,
  `lc-conv-repos`, `lc-conv-status`, `lc-working`, `lc-log`, `lc-lines`, `lc-user`, `lc-text`, `lc-info`.
- Les outils : `lc-tools-line`, `lc-tools-body`, `lc-call`, `lc-call-name`, `lc-call-output`, `lc-diff`,
  `lc-diff-head`, `lc-diff-body`, `lc-diff-line` (`added`, `removed`).
- Les cartes : `lc-card`, `lc-command`, `lc-plan`, `lc-decided` ; les questions : `lc-questions`, `lc-question`,
  `lc-options`, `lc-option` (`data-checked`, `other`), `lc-option-text`, `lc-option-input`, `lc-question-split`,
  `lc-preview`, `lc-add-note`, `lc-questions-left`.
- Le message : `lc-compose`, `lc-to-end`, `lc-box`, `lc-field`, `lc-bar`, `lc-send` (`ready`), `lc-attached`,
  `lc-attachment`.
- Le contexte : `lc-context`, `lc-ctx-panel`, `lc-ctx-title`, `lc-ctx-task`, `lc-ctx-attach`, `lc-ctx-worktree`,
  `lc-ctx-path`, `lc-ctx-line`, `lc-added`, `lc-removed`, `lc-task-field`.
- Éteint, première visite : `lc-off`, `lc-empty`, `lc-empty-grid`, `lc-check`, `lc-check-text`,
  `lc-task`.
- La nouvelle session : `lc-new`, `lc-new-head`, `lc-new-body`, `lc-new-section`, `lc-new-textarea`,
  `lc-new-settings`.
- Réglages › Claude : `lc-settings-block`, `lc-repo`, `lc-repo-form`.

## Tests

`tests/` (Vitest, dans Node) : `npx vitest run --config tests/vitest.config.ts` depuis ce dossier. Ceux de `ui/` sont
lancés par le Vitest de Bidule quand les modules y sont liés.
