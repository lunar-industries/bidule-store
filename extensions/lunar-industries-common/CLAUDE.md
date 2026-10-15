# Commun (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module.

Ce module porte ce que les modules Lunar Industries partagent. Côté serveur, ce sont les branches telles que le cœur
les a (tâche, revue, CI), le lien d'une branche à une tâche fait à la main, et les réglages communs (branches
d'intégration, cibles des MR, nommage des branches). Les autres modules les demandent par ses commandes
(`lunar-industries-common.branches`, `.link`, `.settings`, `.setTarget`) et n'importent de lui que des types
(`contract.ts`) : une fois empaquetés, les modules ne se voient pas.

## Les composants d'interface (`ui/`)

Le module n'a pas d'interface à lui (pas de `ui/index.tsx`). Son dossier `ui/` garde les composants que les modules
partagent, importés par `@bidule/ext-lunar-industries-common/ui/menu` et `…/ui/list` (`exports` de son
`package.json`). Vite les recopie dans le paquet de chaque module qui les importe, au moment de le construire
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

Ses tests sont à côté (`ui/menu.test.tsx`, `ui/list.test.tsx`), lancés par le Vitest de Bidule quand les modules y
sont liés.

## Tests du serveur

`tests/` (Vitest, dans Node) : `npx vitest run --config tests/vitest.config.ts` depuis ce dossier.
