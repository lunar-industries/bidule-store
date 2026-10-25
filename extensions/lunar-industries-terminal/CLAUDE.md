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

- **Le module WebAssembly chargé ici** (`vtModule()`). `Ghostty.load()` de ghostty-web le demande par `fetch` à une
  adresse `data:`, que la CSP de la page de l'app refuse (`connect-src 'self'`), puis à `./ghostty-vt.wasm`, que
  l'app ne sert pas. Le module importe donc le fichier par `?url` : dans l'app construite et en développement, c'est
  un fichier de la même origine (demandé par `fetch`, permis) ; dans un paquet du store, construit comme une
  bibliothèque, ce sont les octets eux-mêmes dans une adresse `data:` (décodés ici, jamais demandés). Il est compilé
  une seule fois. Compiler du WebAssembly demande `'wasm-unsafe-eval'` dans le `script-src` de la page, que le cœur
  ne donne pas encore (`core/api/app/controllers/shells_controller.ts`) : sans lui, la page du module dit pourquoi
  le terminal ne se charge pas (`ui/problem.ts`) et propose le Terminal officiel en attendant. En développement, la
  page est servie par Vite, sans CSP : ce cas ne s'y voit pas.
- **Une instance WebAssembly par terminal** (`emulator()`). Par défaut, ghostty-web partage une instance entre tous
  ses terminaux et réutilise la mémoire d'un terminal fermé sans l'effacer : le terminal suivant montrait des restes
  de l'ancien (coder/ghostty-web#138, #141). Chaque terminal reçoit donc la sienne (`new Terminal({ ghostty })`) du
  module déjà compilé ; sa mémoire part avec lui.
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
- **Les touches que ghostty-web 0.4.0 envoie mal** (`ui/keys.ts`) : il lit Maj comme aucune touche de modification
  avec Tab, Début, Fin, Suppr et F1 à F12 (Maj+Tab envoyait une tabulation, et Claude Code change de mode avec le
  retour de tabulation, `ESC [ Z`), et il envoie Alt+caractère sans le préfixe `ESC` (Alt+b, Alt+Entrée : readline,
  emacs, tmux et Claude Code perdent leurs raccourcis Alt). Le module envoie les séquences de xterm à sa place,
  sauf Alt sous macOS, où Option sert à taper des caractères (coder/ghostty-web#109, #137, #203). Maj+PagePréc et
  Maj+PageSuiv font défiler l'historique, comme dans l'officiel. Une version de ghostty-web qui les corrige rendra ce
  module inutile pour ces touches.
- **Les liens** : ghostty-web compte lignes et colonnes à partir de 0 ; il n'ouvre une adresse web qu'avec Ctrl+clic,
  le module l'ouvre d'un simple clic (`findUrls`), comme l'officiel.
- **Le thème** est lu à la création de chaque terminal (`ui/theme.ts`) : ghostty-web fixe les couleurs des cellules
  à leur écriture et ne sait pas changer de thème ensuite. Un thème choisi plus tard ne vaut que pour les nouveaux
  onglets : le fond du volet garde la couleur prise à la création (le raccord ne se voit pas), et la mascotte le dit
  quand des terminaux sont ouverts (`ui/theme-notice.ts`).
- **Le champ caché** de ghostty-web, nommé « Terminal input », est renommé « Saisie du terminal ».
- **Effacer** remonte la ligne du curseur en haut puis efface l'historique (CSI S, CSI 3 J), comme `clear()` de
  xterm.js ; celui de ghostty-web effaçait aussi l'invite.

Limites connues de ghostty-web 0.4.0 : son historique garde sa taille par défaut (10 000) ; les liens ne marchent pas
sur l'écran secondaire (un programme plein écran) ; chaque terminal dessine dans une boucle d'animation tant qu'il
existe, même caché (le navigateur la suspend quand la fenêtre est cachée).

## La page (maquette « Terminal Lunar »)

- **Les onglets** (`ui/TabStrip.tsx`) : un seul arrêt de Tab, sur l'onglet actif ; ← → Début Fin passent d'un onglet à
  l'autre et l'affichent, Suppr le ferme, la touche Menu ouvre son menu. Chaque onglet est un seul bouton
  (`role="tab"`) ; sa × est hors de la liste pour un lecteur d'écran (`aria-hidden`, la souris seule : Suppr la
  remplace au clavier). Le clic droit d'un onglet ouvre le menu commun (`tabEntries` de `ui/TabMenu.tsx` : renommer,
  sa couleur sur une ligne à soi, fermer).
- **Un onglet divisé** montre ses terminaux côte à côte dans son bouton (`PaneTitles`) : le titre de chacun, un clic
  pour y aller, un clic du milieu pour fermer ce seul volet ; celui qui a le focus est mis en avant. Dans la liste
  (quand les onglets ne tiennent plus en ligne), l'onglet porte les titres de ses terminaux (`heading`).
- **Fermer** un onglet ou un volet où une commande tourne (`commands.running`, d'après l'intégration du shell) demande
  d'abord la confirmation commune, le focus sur « Annuler » (`askClose` de `ui/tabs.ts`) ; à l'invite, il se ferme
  aussitôt.
- **La recherche** : Ctrl+Maj+R (« Rechercher »), ou la
  loupe au bord du bandeau. Son champ a l'anneau de focus, et elle dit « Aucun résultat ».
- **Le clic droit dans le terminal** ouvre le menu commun ; « Copier » est grisé sans sélection, avec sa raison.
- **Les états** : « Ouverture du terminal… » pendant que le premier se charge (`opening`), sans bouton ; un terminal
  qui ne peut pas se charger le dit (`Empty` commun, avec Réglages › Rôles) et « + », « Scripts » et la loupe
  disparaissent ; la ligne « Relancer » d'un shell arrêté.
- **Les scripts** : une palette sans script dit pourquoi (« Aucun script dans … », « Aucun dépôt connu »).
- **Un terminal qui attend ta réponse** se voit depuis les autres pages : la partie de fond (`ui/index.tsx`) met leur
  nombre sur l'onglet Terminal du bandeau, et l'onglet du terminal a son point jaune. Deux sources : la marque
  `waiting` qu'une extension pose sur le dossier d'un onglet (`terminal.mark`, les sessions que l'app a lancées), et la
  notification qu'un programme envoie à son terminal (`notificationOf` de `ui/osc.ts` : OSC 9 d'iTerm2, OSC 777 de
  Ghostty, OSC 99 de Kitty), reçue pendant que tu regardes ailleurs. Claude Code n'en envoie que si son réglage
  `preferredNotifChannel` le demande (`iterm2`, `ghostty` ou `kitty` ; « auto » n'envoie rien, le terminal se disant
  `TERM_PROGRAM=Bidule`). La marque d'une notification part quand tu reviens à l'onglet ou y tapes quelque chose ; la
  fenêtre au second plan, le système la dit aussi.

## Classes CSS

Elles sont dans `ui/lterm.css`, toutes sous `lterm-`, jamais les `terminal-` de l'officiel : les deux pages peuvent
être chargées ensemble. Ce sont celles de l'officiel renommées (voir son `CLAUDE.md`), sans les règles de xterm.js
(ghostty-web dessine sur un canvas, sans feuille de style), plus :

- `lterm-pane` : l'élément de ghostty-web (son canvas et le champ caché qui reçoit le clavier, placé en absolu),
  `position: relative` et `overflow: hidden`.
- `lterm-split` étire ses volets (`align-items: stretch`) : il porte aussi la classe `row` du design system, qui les
  centrerait, et un volet prendrait alors la taille de son canvas.
- `lterm-tab-panes` (sur le bouton d'un onglet divisé) > `lterm-tab-name` (le nom donné par l'utilisateur) et
  `lterm-tab-pane` (un terminal ; un trait entre deux ; `focused` net, l'autre estompé sur l'onglet affiché).
- `lterm-search-count` (`none` : « Aucun résultat », en rouge).

## Tests

Ceux de l'interface sont à côté du code (`ui/*.test.ts`), lancés par le Vitest de Bidule. Ceux du serveur sont dans
`tests/service.test.ts` (Vitest, contexte simulé : les scripts d'un dépôt, le shell d'une tâche ou d'une branche) :
`npx vitest run --config tests/vitest.config.ts` depuis ce dossier. Le test de contrat du store
(`scripts/check-host.sh`) vérifie que le module tient le rôle quand l'officiel est absent.
