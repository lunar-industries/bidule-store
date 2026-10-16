# Temps (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module. Sa page est `/lunar-industries/temps`, reprise de la page Temps de
quack-board (Simon) et dessinée d'après la maquette « Temps Lunar » (Claude Design).

## Le serveur (`server/`)

Une journée vaut 1, répartie en vingtièmes entre des lignes (une tâche, ou aucune : réunion, absence, déploiement),
chacune avec l'étiquette du Time Log. Les routes sont listées dans `contract.ts`.

- **`engine.ts`** reconstitue la journée depuis l'activité du cœur (celle de git et celle des tâches) et propose les
  parts, sans modèle d'IA.
- **`days.ts`** tient les journées : le brouillon suit l'activité tant que l'utilisateur ne l'a pas changé (`edited`) ;
  une journée que le Time Log a est montrée telle qu'il l'a, et « Modifier » en refait un brouillon. Le Time Log est
  recopié sur 35 jours en arrière et 60 en avant, relu au bout de 10 minutes, ou tout de suite par « Relire le Time
  Log » (`reread`, qui dit pourquoi la lecture a échoué). Chaque ligne porte le titre et la référence de sa tâche
  (`taskTitle`, `taskRef`), lus parmi toutes les tâches du cœur : une tâche où l'utilisateur n'a pas de rôle, mais sur
  laquelle il a agi (un commit sur sa branche), garde son nom.
- **`work.ts`** lit le cœur (dépôts, branches, activité, tâches) et trouve le Time Log (le fournisseur des objets
  `timeEntry`, Notion). Ce que l'activité dit de l'utilisateur est l'affaire de chaque fournisseur : Temps prend
  toute l'activité qu'on lui donne.

## La page (`ui/TempsPage.tsx`)

- **Au bord du bandeau** (`BannerTools`, page `with-tools`) : « Aujourd'hui », « Calendrier » et « Réglages » (ceux du
  module). Le calendrier (`ui/Calendar.tsx`) est dessiné dans le `body` de la page (`menu floating`), calé sous son
  bouton et gardé dans la fenêtre : un seul jour tabulable, les flèches passent au mois voisin (année et mois ensemble,
  `monthStep`), les boutons de mois laissent le focus où il est, Échap le ferme et rend le focus à « Calendrier », une
  légende dit les points.
- **La semaine** à gauche : un seul arrêt de Tab, les flèches passent d'un jour à l'autre ; pendant sa lecture, des
  points creux et « … » (jamais « aucune activité »), en cas d'échec le message avec Réessayer.
- **Le jour** à droite : la barre (un segment par ligne, la couleur de l'étiquette mêlée à la carte sous le texte du
  thème, lisible sur tous les thèmes), dont on tire les frontières à la souris ou aux flèches ; puis une ligne par
  tâche, avec son étiquette et sa part dans deux listes (la part de 0 à 1 j par 0,05). Une branche sans tâche se règle
  sous sa ligne. Le menu ⋯ (le menu commun de `lunar-industries-common`) : « Relire le Time Log », « Marquer
  absent… », « Recalculer depuis git et les tâches… », « Abandonner les modifications… ». Les trois derniers demandent
  confirmation quand le brouillon a des changements faits à la main (`edited`, ou des modifications pas encore
  enregistrées).
- **La barre d'envoi** dit ce qui manque pour envoyer ; pour un jour envoyé, quand il l'a été, « Relire le Time Log »
  et « Modifier ». En mode focus, la mascotte reste au-dessus d'elle (`useMascotClearance`).
- **Le matin**, avant toute activité, la page ouvre le jour de travail précédent s'il reste à valider ou à remplir, et
  la mascotte le dit (« Hier n'est pas encore validé, je te l'ai ouvert »).
- **Le chargement et les échecs** (`Loading`, `Alert` et `Empty` de `lunar-industries-common`) : « Lecture de la
  journée… » pendant la première lecture d'un jour ; un échec est dit avec Réessayer, au-dessus de la dernière lecture
  s'il y en a une. Les champs de tâche sont le `TaskField` commun : il se vide après chaque choix ; celui d'une branche
  sans tâche propose d'abord les tâches qui partagent ses mots. Il dit « Aucune tâche ne correspond », « Aucun module
  de tâches actif » (avec Réglages › Extensions) ou pourquoi les tâches n'ont pas pu être lues (avec Réessayer).
- **Les confirmations** sont le `confirm` commun. Marquer absent, recalculer et abandonner les modifications font
  perdre des changements faits à la main : le focus est sur « Annuler » et l'action en rouge. Les icônes (les flèches
  de la semaine et du calendrier, « plus », le chevron d'une ligne) et les teintes des étiquettes sont les communes.
- **La fenêtre étroite** : sous 1 200 px, l'étiquette et la part d'une ligne passent sous son nom ; sous 900 px, la
  semaine passe au-dessus du jour, ses sept jours sur une ligne.
- **La partie de fond** (`ui/Background.tsx`) met sur l'onglet le nombre de jours à valider ou à remplir parmi les
  sept derniers.

Ce qui se calcule sans rien dessiner est dans `ui/format.ts` et testé dans `ui/format.test.ts`.

## Classes CSS

Toutes dans `ui/temps.css`, sous `lit-` :

- La page : `lit-temps`, `lit-nowrap`.
- La semaine : `lit-week`, `lit-week-head`, `lit-week-title`, `lit-week-name`, `lit-week-days`, `lit-week-day` (`today`, `off`), `lit-week-dot` (`hollow`),
  `lit-week-day-name`, `lit-week-day-today`, `lit-week-day-state`, `lit-week-day-total` (`recorded`),
  `lit-week-work`, `lit-week-pending`, `lit-week-pending-text`.
- Le calendrier : `lit-cal`, `lit-cal-title`, `lit-cal-grid`, `lit-cal-week`, `lit-cal-letter`, `lit-cal-day`
  (`today`, `future`), `lit-cal-dot`, `lit-cal-key`, `lit-cal-key-dot`.
- Le jour : `lit-day`, `lit-day-head`, `lit-day-title`, `lit-day-legend`,
  `lit-problem` (pourquoi la journée ne s'envoie pas), `lit-bar-wrap`, `lit-bar`, `lit-rest`, `lit-scale`, `lit-seg`
  (`orphan`), `lit-seg-title`, `lit-seg-share`, `lit-grip`.
- Les lignes : `lit-lines`, `lit-line` (`zero`, `open`), `lit-line-row`, `lit-line-name`, `lit-chevron`,
  `lit-chip-dot` (`orphan`), `lit-line-title`, `lit-line-where`, `lit-line-label`, `lit-line-share-pick`,
  `lit-line-share`, `lit-line-detail`, `lit-line-actions`, `lit-line-fix`, `lit-started`, `lit-evidence`, `lit-chips`,
  `lit-check`.
- L'ajout d'une ligne : `lit-attach`, `lit-add`, `lit-empty` (autour de l'`Empty` commun), `lit-empty-add`.
- La barre d'envoi : `lit-foot`, `lit-checks`, `lit-check-line` (`ok`).
- Réglages › Temps : `lit-workdays`.

## Tests

`tests/` (Vitest, dans Node) : `npx vitest run --config tests/vitest.config.ts` depuis ce dossier. `ui/format.test.ts`
est lancé par le Vitest de Bidule quand les modules y sont liés.
