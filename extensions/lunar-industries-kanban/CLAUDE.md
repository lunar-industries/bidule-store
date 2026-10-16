# Kanban (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module. Sa page est `/lunar-industries/kanban`, dessinée d'après la maquette
« Kanban Lunar » (Claude Design).

## Le tableau (`ui/KanbanPage.tsx`)

Les tâches viennent du cœur (`readTasks`, comme pour tout Kanban), déplacées par l'action `task.move` ; les branches,
revues et CI des cartes viennent du module commun (`lunar-industries-common`), par les routes du module
(`contract.ts`). Les pastilles et les actions des autres extensions passent par le point `kanban`, que le module
déclare comme l'officiel (`ui/points.ts`) ; chaque pastille est dessinée dans sa limite d'erreur.

- **Au bord du bandeau** : la recherche (`ToolSearch`, dans le titre, la référence et les branches), le filtre de rôle
  (`ToolFilter` : Toutes, Responsable, Participant, gardé par le réglage caché `lunar-industries-kanban.role`), le
  bouton des branches sans tâche et Synchroniser (aussi dans la palette).
- **« À surveiller »** : les tâches en retard, pour aujourd'hui et à CI rouge, chacune un bouton qui filtre le tableau.
- **Les colonnes** : une par statut de la source, moins celles masquées ou réunies dans une autre (Réglages › Kanban),
  sous le nom de leur étape. Chaque colonne défile seule sous son en-tête (`page fill`), et se replie en bande (les
  terminées le sont d'office ; le choix est gardé dans `lunar-industries-kanban.toggled`). Les cartes y sont triées :
  en retard d'abord, puis par échéance (`sortTasks`).
- **Le clavier** : un seul arrêt de Tab pour tout le tableau. Les flèches passent d'une carte à l'autre (gauche et
  droite d'une colonne ouverte à la suivante), Début et Fin vont aux bouts de la colonne, Entrée ouvre la tâche dans
  son outil, la touche Menu ou Maj+F10 ouvre son menu (le menu commun), Alt+← → la déplace vers la colonne voisine,
  Espace la sélectionne (Maj : jusqu'à elle), Ctrl+A (⌘A) sélectionne tout ce qui est affiché, Échap désélectionne.
  À la souris : Ctrl+clic et Maj+clic sélectionnent, le double clic ouvre, le clic droit ouvre le menu. Les raccourcis
  sont déclarés dans le manifeste (`contributes.shortcuts`).
- **Déplacer** : par le menu, Alt+flèche ou un glisser, une carte ou toute la sélection. Le tableau change aussitôt,
  revient en arrière si l'outil refuse, et une notification propose d'annuler pendant 8 s (`toast` du SDK).
- **Les branches sans tâche** (`ui/BranchPanel.tsx`) : le panneau latéral commun (`SidePanel` de
  `lunar-industries-common`), par-dessus le tableau, ouvert depuis le bord du bandeau. Échap ou sa × le ferment et
  rendent le focus au bouton du bandeau ; un clic en dehors le ferme aussi, sauf sur ce bouton, qui le referme
  lui-même. Les branches récentes qu'aucune carte ne réclame, par dépôt ; on en glisse une sur une carte, ou Entrée
  ouvre le champ de tâche commun (`TaskField`, toujours ouvert dans la ligne), où viennent d'abord les tâches dont le
  titre ou la référence a les mots de la branche (`hint`). Une liaison s'annule depuis sa notification.
- **Les états sans tableau** (`Empty` et `Alert` communs) : « Lecture des tâches… » et des colonnes vides pendant le
  chargement ; une erreur avec Réessayer (au-dessus du tableau déjà lu quand il y en a un) ; sans source, un bouton
  vers Réglages › Extensions ; une source non configurée, un bouton vers ses réglages ; aucune tâche, Synchroniser et
  les statuts masqués.
- **Les icônes** (synchroniser, replier une colonne, la coche d'une carte choisie) et les teintes des étiquettes sont
  les communes.
- **La fenêtre étroite** (moins de 1 000 px) : une étape à la fois, choisie par des onglets.
- **La partie de fond** (`ui/index.tsx`, `Count`) met sur l'onglet le nombre de tâches en retard ou à rendre
  aujourd'hui.

Ce qui se calcule sans rien dessiner est dans `ui/layout.ts` (colonnes, réunions de statuts, ordre, badges, notes,
marques, filtres, tri) et testé dans `tests/layout.test.ts`.

`server/stale_days.ts` reste : une migration déjà livrée (`…_stale_days_from_kanban.ts`) l'importe.

## Classes CSS

Toutes dans `ui/kanban.css`, sous `lik-` :

- La page : `lik-page`, `lik-attention-row`,
  `lik-attention-title`, `lik-attention` (`lik-attention-late`, `lik-attention-today`, `lik-attention-ci` ;
  `aria-pressed` quand il filtre), `lik-stage-tabs` (fenêtre étroite).
- Le tableau : `lik-board` (`dragging` pendant un glisser), `lik-stage`, `lik-stage-title`, `lik-stage-columns`,
  `lik-column` (`drop-over`), `lik-column-head`, `lik-column-toggle`, `lik-cards`, `lik-folded` (une colonne repliée),
  `lik-folded-name`, `lik-drop-hint`.
- La carte : `lik-card` (`late`, `selected`, `done`, `branch-over`), `lik-card-head`, `lik-check-mark`, `lik-ref`,
  `lik-tool`, `lik-branch`, `lik-link-hint`, `lik-marks`, `lik-mark`, `lik-note`.
- Les états sans tableau : `lik-loading`, `lik-skeleton`, `lik-empty-actions`.
- Le contenu du panneau des branches : `lik-panel-toggle` (son bouton au bord du bandeau), `lik-panel-content`,
  `lik-panel-repo`, `lik-panel-list`, `lik-panel-row` (`picking`), `lik-panel-line`, `lik-panel-note`.
- « Lier des branches… » : `lik-link-form`, `lik-checks`, `lik-check-group`, `lik-check`, `lik-check-name`,
  `lik-check-note`.
- Réglages › Kanban : `lik-statuses`, `lik-status` (`off`, `dragging`, `drop-before`, `drop-after`),
  `lik-status-grip`, `lik-status-name`, `lik-status-info`, `lik-status-choice`, `lik-missing`.

## Tests

`tests/` (Vitest, dans Node) : `npx vitest run --config tests/vitest.config.ts` depuis ce dossier.
