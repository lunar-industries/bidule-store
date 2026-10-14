# Terminal (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module. Il reprend le terminal officiel (`extensions/terminal` de Bidule)
fonction pour fonction, mais le dessine avec [ghostty-web](https://github.com/coder/ghostty-web) (l'émulateur de
Ghostty compilé en WebAssembly, avec une API proche de celle de xterm.js) au lieu de xterm.js. La part du cœur ne
change pas : les shells tournent dans le process principal d'Electron (`core/desktop/src/terminal.ts`), une extension
prépare une commande par `ctx.terminal.prepare`, et le shell de l'utilisateur marque ses commandes grâce à
l'intégration du shell (`core/desktop/src/shell-scripts.ts`).

## Le rôle et la page

Le module fournit le rôle `terminal`, comme l'officiel : il déclare les mêmes commandes `terminal.new`,
`terminal.open`, `terminal.folders`, `terminal.mark`, `terminal.task` et `terminal.branch`, avec la même déclaration de
types dans `contract.ts` (les deux copies doivent rester identiques, sinon la compilation de Bidule échoue). Quand les
deux terminaux sont actifs, aucun ne tient le rôle tant que l'utilisateur n'en a pas choisi un dans Réglages › Rôles ;
les extensions qui exigent le rôle (`claude`, `docker`) sont en erreur en attendant. Le module ne déclare pas de
conflit avec l'officiel : l'officiel ne pourrait alors plus être désactivé, puisque Claude en dépendrait seul.

Sa page est `/lunar-industries/terminal` (`ui/page.ts`) ; ses réglages sont `lunar-industries-terminal.onVisit` et
`lunar-industries-terminal.scriptValues` (caché), ses routes `/api/ext/lunar-industries-terminal/…`. Le reste (onglets
qui survivent à la page, volets divisés, recherche, scripts du dépôt dans la palette, liens, point d'état des onglets)
se comporte comme dans l'officiel, dont le `CLAUDE.md` décrit le détail.

## Ce que ghostty-web demande de plus (`ui/ghostty.ts`, `ui/tabs.ts`)

Le module épingle une version exacte de ghostty-web (`package.json`), parce qu'il touche à son intérieur à un endroit
(la sélection) et contourne plusieurs de ses défauts :

- **Une instance WebAssembly par terminal** (`emulator()`). Par défaut, ghostty-web partage une instance entre tous
  ses terminaux et réutilise la mémoire d'un terminal fermé sans l'effacer : le terminal suivant montrait des restes
  de l'ancien (coder/ghostty-web#138, #141). Chaque terminal reçoit donc la sienne (`new Terminal({ ghostty })`), qui
  part avec lui ; cela coûte une compilation du module (environ 400 Ko) à chaque nouveau volet.
- **Ouvert dès sa création.** ghostty-web n'écrit rien dans un terminal qui n'est pas ouvert : chaque volet ouvre le
  sien dans sa boîte (`lterm-pane`) dès qu'il est créé, même hors de la page, et la boîte est ensuite déplacée.
  Redémarrer un shell écrit `ESC c` au lieu d'appeler `reset()`, qui crée un nouvel émulateur que la sélection ne suit
  pas.
- **L'intégration du shell** (OSC 133, 633;E, 7) est lue dans la sortie avant de l'écrire (`ui/osc.ts`, une séquence
  coupée entre deux morceaux est gardée jusqu'à sa fin) : ghostty-web n'a pas de `parser.registerOscHandler`.
- **La recherche** est écrite ici (`ui/find.ts`) : ghostty-web n'a pas de module de recherche ni de décorations. Le
  résultat montré est amené à l'écran et sélectionné ; les autres ne sont pas surlignés.
- **La sélection** est posée directement (`selectCells`) : `select` et `selectAll` de ghostty-web comptent les lignes
  depuis le haut de la vue alors que sa sélection les compte depuis le début de l'historique.
- **Le clavier** : le gestionnaire de touches de ghostty-web rend `true` pour garder une touche, l'inverse de xterm.js.
  Ctrl+V reste au shell (^V), ⌘V et Ctrl+Maj+V collent ; Ctrl+K (⌘K sous macOS) est rendu `true` pour que le shell ne
  le reçoive pas, et remonte jusqu'à la palette, que ghostty-web n'arrête pas dans ce cas.
- **Les liens** : ghostty-web compte lignes et colonnes à partir de 0 ; il n'ouvre une adresse web qu'avec Ctrl+clic,
  le module l'ouvre d'un simple clic (`findUrls`), comme l'officiel.
- **Le thème** est lu à la création de chaque terminal (`ui/theme.ts`) : ghostty-web fixe les couleurs des cellules
  à leur écriture et ne sait pas changer de thème ensuite. Un thème choisi plus tard ne vaut que pour les nouveaux
  onglets.
- **Effacer** remonte la ligne du curseur en haut puis efface l'historique (CSI S, CSI 3 J), comme `clear()` de
  xterm.js ; celui de ghostty-web effaçait aussi l'invite.

Limites connues de ghostty-web 0.4.0 : son historique garde sa taille par défaut (10 000) ; les liens ne marchent pas
sur l'écran secondaire (un programme plein écran) ; chaque terminal dessine dans une boucle d'animation tant qu'il
existe, même caché (le navigateur la suspend quand la fenêtre est cachée).

## Un onglet divisé dans la barre

Un onglet divisé montre ses terminaux côte à côte dans sa pastille (`PaneTitles` de `ui/TabStrip.tsx`) : le titre de
chacun, un clic pour y aller, un clic du milieu pour fermer ce seul volet ; celui qui a le focus est mis en avant. Dans
la liste (quand les onglets ne tiennent plus en ligne), l'onglet porte les titres de ses terminaux (`heading`).

## Classes CSS

Elles sont dans `ui/lterm.css`, toutes sous `lterm-`, jamais les `terminal-` de l'officiel : les deux pages peuvent
être chargées ensemble. Ce sont celles de l'officiel renommées (voir son `CLAUDE.md`), sans les règles de xterm.js
(ghostty-web dessine sur un canvas, sans feuille de style), plus :

- `lterm-pane` : l'élément de ghostty-web (son canvas et le champ caché qui reçoit le clavier, placé en absolu),
  `position: relative` et `overflow: hidden`.
- `lterm-split` étire ses volets (`align-items: stretch`) : il porte aussi la classe `row` du design system, qui les
  centrerait, et un volet prendrait alors la taille de son canvas.
- `lterm-tab-panes` > `lterm-tab-name` (le nom donné par l'utilisateur) et `lterm-tab-pane` (un terminal ; un trait
  entre deux ; `focused` net, l'autre estompé sur l'onglet affiché).

## Tests

Ceux de l'interface sont à côté du code (`ui/*.test.ts`), lancés par le Vitest de Bidule. Ceux du serveur sont dans
`tests/service.test.ts` (Vitest, contexte simulé : les scripts d'un dépôt, le shell d'une tâche ou d'une branche) :
`npx vitest run --config tests/vitest.config.ts` depuis ce dossier. Le test de contrat du store
(`scripts/check-host.sh`) vérifie que le module tient le rôle quand l'officiel est absent.
