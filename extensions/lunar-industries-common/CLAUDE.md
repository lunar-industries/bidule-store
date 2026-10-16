# Commun (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module.

Ce module porte ce que les modules Lunar Industries partagent. Côté serveur, ce sont les branches telles que le cœur
les a (tâche, revue, CI), le lien d'une branche à une tâche fait à la main, et les réglages communs (branches
d'intégration, cibles des revues, nommage des branches). Une revue s'appelle MR sur GitLab et PR sur GitHub ; un
texte qui vaut pour les deux dit « revue (MR ou PR) ». Les autres modules les demandent par ses commandes
(`lunar-industries-common.branches`, `.link`, `.settings`, `.setTarget`) et n'importent de lui que des types
(`contract.ts`) : une fois empaquetés, les modules ne se voient pas.

## Les composants d'interface (`ui/`)

Le module n'a pas d'interface à lui (pas de `ui/index.tsx`). Son dossier `ui/` garde les composants que les modules
partagent, dessinés d'après la maquette « Composants communs Lunar » (Claude Design), importés par
`@bidule/ext-lunar-industries-common/ui/<nom>` (`exports` de son `package.json`). Leur CSS (`ui/common.css`, importé
par chaque composant qui en a besoin) entre dans le `style.css` de chaque module qui les importe. Vite les recopie dans le paquet de chaque module qui les importe, au moment de le construire
(`buildUi` de Bidule) : aucun module ne dépend de celui-ci à l'exécution, et ces fichiers ne sont pas dans son propre
paquet. L'import par le nom du paquet marche de la même façon quand les modules sont liés dans un checkout de Bidule
(`npm run store:link`) et quand la CI du store les y copie.

- **`ui/menu.tsx`** : `useMenu()` rend `[menu, open]`. `open` prend un clic droit (le menu s'ouvre au pointeur), une
  touche (`isMenuKey` : la touche Menu ou Maj+F10, le menu s'ouvre sous l'élément) ou un élément (un bouton « ⋯ », le
  menu s'ouvre dessous, et un second clic le referme). Les entrées sont des `MenuItem` (`label`, `run`, `disabled`, qui
  peut être la raison, montrée en infobulle, et `shortcut`), des `'separator'`, ou `null` et `false`, laissés de côté
  pour écrire un menu avec ses conditions. Le menu prend le focus ; les flèches, Début, Fin et une lettre le
  parcourent ; Entrée ou un clic lance une entrée, après avoir rendu le focus à l'élément d'origine ; Échap et Tab le
  ferment en rendant le focus ; un clic ailleurs, la fenêtre qui perd le focus, change de taille ou défile le ferment.
  Il est dessiné dans le `body` de la page avec les classes du cœur (`menu floating`, `menu-item`, `menu-shortcut`,
  `menu-sep`) et recalé dans la fenêtre d'après sa taille réelle. Une entrée qui échoue est dite par la mascotte.
- **`ui/list.ts`** : `useListKeys` fait d'une liste un seul arrêt de tabulation, sur sa ligne active (que le module
  garde : `active`, `setActive`). Les flèches, Début, Fin, Page précédente et Page suivante changent de ligne et y
  mettent le focus ; Entrée, Espace et Suppr appellent `onOpen`, `onToggle` et `onDelete` ; la touche Menu et Maj+F10
  appellent `onMenu`. Une touche venue d'un bouton de la ligne reste à ce bouton. `nextTicks` (un clic sur une case,
  avec Maj pour une plage depuis la dernière case cochée) et `allTicks` (Ctrl+A) calculent les cases cochées, que le
  module range où il veut.
- Le menu prend aussi une ligne à soi (`MenuRow` : `{ row, label }`, les couleurs d'un onglet), dont les boutons de
  rôle `menuitemradio` ou `menuitemcheckbox` sont parcourus par les flèches comme les entrées, et s'ouvre au-dessus
  d'un élément avec `{ above: true }` (un champ en bas de la page). Une entrée peut avoir une `icon` devant son libellé
  et une `hint` dessous (la description d'une commande) ; `{ wide: true }` donne une liste large qui défile (les
  commandes de Claude).
- **`ui/panel.tsx`** : `SidePanel`, le panneau latéral, par-dessus la page au bord droit de la fenêtre, sous la barre
  de titre : l'ouvrir ou le fermer ne déplace rien. Son en-tête (le titre, `mono` pour un nom de branche, les
  `actions` avant la ×, le `subtitle`), son corps qui défile, ses `keys` au pied (cachées sous 1 000 px). Échap ou la
  × le ferment et rendent le focus à ce qui l'avait à son ouverture (ou à `returnFocus`), sans faire défiler la page
  jusqu'à lui (`preventScroll`). Un clic en dehors le ferme aussi, sauf dans un menu, dans un dialogue ou pendant
  qu'un dialogue est ouvert, et sur ce que nomme `keepOpenOn` (les lignes d'un tableau, qui ouvrent leur propre
  détail). `onClose` reçoit la manière : `key`, `button` ou `outside`.
- **`ui/tasks.tsx`** : le choix d'une tâche. `findTasks` cherche chaque mot tapé dans le titre, la référence et
  `also` (les branches de la tâche), sans tenir compte des accents ; d'abord les tâches qui partagent le plus de mots
  avec `hint` (le nom d'une branche), puis celles qui ne sont pas terminées ; huit au plus. `useTaskBoard` lit les
  tâches (null pendant la lecture) et dit `problem` : aucun module de tâches (`none`), ou la lecture a échoué
  (`failed`), jamais confondus avec une liste vide. `TaskField` : avec `value`, il montre la tâche choisie et la remet
  si on le quitte sans choisir ; sans, il se vide après chaque choix ; `inline` garde la liste ouverte dans le flux
  (Échap appelle `onCancel`). `pickTask` ouvre la même liste dans un dialogue qui confirme. Les phrases sont les
  mêmes partout : « Aucune tâche ne correspond à « … ». », « Aucun module de tâches actif… » avec Réglages ›
  Extensions, « Les tâches n'ont pas pu être lues : … » avec Réessayer, « Lecture des tâches… ».
- **`ui/states.tsx`** : `Alert` (une lecture qui a échoué, au-dessus de ce qui reste montré, avec Réessayer),
  `Loading` (toujours annoncé aux lecteurs d'écran, `lines` dessine des lignes grises), `Empty` (rien à montrer : un
  titre, une phrase, une action ; `failed` quand la première lecture a échoué).
- **`ui/confirm.tsx`** : `confirm({ title, text, action, danger })` rend la réponse. Une écriture ordinaire a le
  focus sur son action (Entrée confirme) ; avec `danger` (supprimer, abandonner des modifications, arrêter Claude en
  plein travail), le focus est sur « Annuler » et l'action est en rouge.
- **`ui/icons.tsx`** : `Icon`, les icônes communes (24 px de base, trait de 2, couleur du texte), décoratives sauf
  avec `label`.

Ses tests sont à côté (`ui/*.test.tsx`), lancés par le Vitest de Bidule quand les modules y sont liés.

## Classes CSS

Toutes dans `ui/common.css`, sous `lunar-` :

- Le menu : `lunar-menu-icon`, `lunar-menu-hint`, `lunar-menu-wide`.
- Le panneau latéral : `lunar-panel`, `lunar-panel-head`, `lunar-panel-title` (`mono`), `lunar-panel-body`,
  `lunar-panel-foot`.
- Le choix d'une tâche : `lunar-tasks` (`floating`), `lunar-tasks-list`, `lunar-tasks-item` (`active`, `done`),
  `lunar-tasks-title`, `lunar-tasks-note`, `lunar-tasks-pick`.
- Lecture, échec, rien à montrer : `lunar-alert`, `lunar-btn-sm`, `lunar-loading`, `lunar-loading-line`,
  `lunar-empty` (`failed`), `lunar-empty-title`.
- La confirmation : `lunar-danger`.
- Les teintes des étiquettes, sur `tag` : `lunar-tone-ok`, `lunar-tone-warn`, `lunar-tone-bad`, `lunar-tone-info`,
  `lunar-tone-neutral`, `lunar-tone-accent`.

## Tests du serveur

`tests/` (Vitest, dans Node) : `npx vitest run --config tests/vitest.config.ts` depuis ce dossier.
