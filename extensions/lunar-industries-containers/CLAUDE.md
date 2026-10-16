# Conteneurs (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module. Sa page est `/lunar-industries/conteneurs`, dessinée d'après la
maquette « Conteneurs Lunar » (Claude Design).

Les moteurs sont ceux de l'extension `docker` : le module lui demande tout par ses actions (`server/index.ts`, client
`ctx.objects.client('docker')`) et écoute ses événements (`docker.changed`, `docker.logs`, `docker.usage`). Il ne
garde lui-même que les conteneurs cochés (`server/selection.ts`, `selection.json` dans son dossier de données).

## La liste (`ui/ContainersPage.tsx`)

- **La lecture** (`ui/store.ts`) : une seule pour toute l'interface, que la page et la partie de fond partagent. Les
  événements des moteurs (`docker.changed`) la relancent, écoutés seulement une fois un moteur trouvé ; des demandes
  qui arrivent pendant une lecture n'en font qu'une après elle.
- **Au bord du bandeau** : la recherche (nom, image, projet, service, port) et le filtre « Actifs » ou « Tous ».
  « Actifs » garde ce qui tourne et ce qui demande un coup d'œil : en pause, qui redémarre, en échec.
- **Un échec** (`isFailed`) : l'état `dead`, ou un arrêt sur un code autre que ceux d'un arrêt voulu (0, 130 pour
  Ctrl-C, 143 et 137 pour `stop`). Il a sa couleur d'alerte et compte sur l'onglet.
- **Les projets** : un cadre par projet Compose, avec sa santé sur tous ses conteneurs, quel que soit le filtre
  (`healthOf` : « 3 sur 4 · db en échec (code 1) »), et ses actions (tout démarrer, redémarrer, arrêter ; le menu
  ajoute cocher le projet et tout supprimer). Les conteneurs hors projet sont réunis sous « Sans projet », qui se
  replie de même mais n'a pas d'actions. Les projets repliés sont gardés tant que l'app tourne.
- **Une ligne** : la case, le service (le nom hors projet), les ports (un clic ouvre, le clic droit copie), le
  processeur et la mémoire, l'état, puis les actions à places fixes (shell, journaux, démarrer ou arrêter, « ⋯ »).
  Dans une fenêtre de moins de 1 000 px, le processeur et la mémoire passent sous l'état, et le shell et les journaux
  vont dans le menu.
- **Le clavier** (`useListKeys` du module commun) : un seul arrêt de Tab pour la liste ; les flèches, Début, Fin,
  Page précédente et suivante ; Entrée ouvre la fiche, Espace coche, Suppr supprime après confirmation, la touche
  Menu ou Maj+F10 ouvre le menu, Ctrl+A (⌘A) coche ce qui est affiché, Échap décoche. À la souris : Ctrl+clic et
  Maj+clic cochent, le double clic ouvre la fiche, le clic droit ouvre le menu.
- **Les cases cochées** sont rangées sous le projet et le service (`tickKeyOf`), sous le nom hors projet : elles
  survivent à un `docker compose up` qui recrée le conteneur avec un autre identifiant. Un service lancé en plusieurs
  exemplaires se coche d'un bloc. Une case dont le conteneur a disparu est oubliée, seulement quand tous les moteurs
  ont répondu.
- **Le menu** (menu commun, `ui/actions.tsx`) : sur une ligne cochée parmi plusieurs, il commence par les actions sur
  les conteneurs cochés et visibles (ni filtrés, ni cherchés, ni repliés), puis viennent celles de la ligne. Une
  action sur plusieurs conteneurs (`actMany`) relit la liste une seule fois et dit ses échecs en un seul message.
- **Les états sans liste** : « Lecture des conteneurs… », une erreur avec Réessayer, ni Docker ni Podman, aucune
  correspondance à la recherche (Effacer la recherche), rien qui tourne (afficher tous les conteneurs ou démarrer un
  projet).

## La fiche (`ui/ContainerView.tsx`)

- **Son adresse** (`ui/route.ts`) : `?conteneur=<moteur>:<nom>` sur le chemin de la page, car le cœur choisit une page
  par son chemin seul. Le nom plutôt que l'identifiant : la fiche survit à une recréation. Échap, Alt+← et le bouton
  « précédent » de la souris ramènent à la liste, le focus sur la ligne d'origine. Quitter la page sur une fiche puis
  revenir par son onglet rouvre cette fiche. La palette ouvre la fiche de chaque conteneur (partie de fond).
- **L'en-tête** : le fil d'Ariane (Conteneurs, le projet), le nom, l'état et la santé, puis les actions.
- **Les journaux** (`ui/Logs.tsx`) : toute la hauteur. La recherche marque et compte ses résultats (Entrée et
  Maj+Entrée, ou ↑ ↓, passent de l'un à l'autre ; Ctrl+F y va), les niveaux filtrent (reconnus en minuscules comme en
  majuscules), « Suivre la fin » se décoche quand on remonte et se recoche en bas, on copie ou enregistre ce qui est
  affiché. Un suivi que le moteur arrête (`ended`) et une lecture impossible sont dits, distincts d'un journal vide.
  Les 2 000 dernières lignes restent.
- **Les autres onglets** (`ui/Tabs.tsx`) : Ressources (courbes depuis l'ouverture, sur une échelle fixe : un cœur ou
  autant de cœurs entiers que dépassés, la limite pour la mémoire ; elles disent pourquoi elles sont vides),
  Environnement (docker 0.3.0 : une valeur au nom de secret est masquée jusqu'à « Afficher »), Fichiers (copier le
  chemin du dossier).
- **Les informations** : ports (ouvrir, copier), santé, redémarrage, commande, image, volumes, réseau, variables,
  identifiant, création, puis le processeur et la mémoire du moment. Dans une fenêtre étroite, elles passent
  au-dessus des journaux, repliées sur une ligne.
- **Les composants communs** (`lunar-industries-common`) : les icônes, les lectures (`Loading`), les échecs (`Alert`,
  avec Réessayer, au-dessus de la dernière lecture), les listes vides (`Empty`) et la confirmation de suppression
  (`confirm`, avec `danger` : le focus sur « Annuler », l'action en rouge).

## La partie de fond (`ui/index.tsx`)

Le compteur de l'onglet (les conteneurs en échec) et une commande de la palette par conteneur, depuis la lecture
partagée.

Ce qui se calcule sans rien dessiner est dans `ui/format.ts`, testé dans `ui/format.test.ts`.

## Classes CSS

Toutes dans `ui/containers.css`, sous `lic-` :

- Communes : `lic-start`, les tons `lic-tone-ok`, `lic-tone-warn`,
  `lic-tone-bad`, `lic-tone-off` (qui posent `--lic-tone` et `--lic-dot`), `lic-strong`, `lic-health`, `lic-pill`,
  `lic-dot`, `lic-port` (`live`).
- La liste : `lic-list`, `lic-list-head`, `lic-ticked`, `lic-totals`, `lic-columns`, `lic-actions-title`,
  `lic-groups`, `lic-group`, `lic-group-head`, `lic-fold`, `lic-group-name`, `lic-group-actions`, `lic-row`
  (`ticked`), `lic-name-cell`, `lic-names`, `lic-name`, `lic-ports`, `lic-cpu`, `lic-memory`, `lic-state`,
  `lic-state-label`, `lic-usage-narrow`, `lic-actions`, `lic-act-wide`, `lic-empty-actions`.
- La fiche : `lic-fiche`, `lic-fiche-head`, `lic-crumbs-head`, `lic-back`, `lic-fiche-name`, `lic-fiche-sub`,
  `lic-fiche-actions`, `lic-fiche-body` (`narrow`), `lic-fiche-main`, `lic-tabs`, `lic-toolbar`, `lic-tab-body`,
  `lic-tab-note`, `lic-check`, `lic-fiche-info`, `lic-info`, `lic-info-ports`, `lic-info-port`, `lic-info-id`,
  `lic-mounts`, `lic-copy`, `lic-link`, `lic-meters`, `lic-meter-block`, `lic-meter-head`, `lic-meter`,
  `lic-meter-fill`.
- Les journaux : `lic-log-search`, `lic-log-count`, `lic-log-step`, `lic-levels`, `lic-level-all`, `lic-level-error`,
  `lic-level-warn`, `lic-level-count`, `lic-notice`, `lic-logs`, `lic-logs-none`, `lic-log` (`error`, `warn`,
  `current`), `lic-log-time`.
- Les onglets : `lic-charts`, `lic-chart`, `lic-chart-head`, `lic-area`, `lic-line`, `lic-env`, `lic-env-row`,
  `lic-env-actions`, `lic-files-tab`, `lic-crumbs`, `lic-files`, `lic-file` (`dir`).

## Tests

`ui/format.test.ts` (Vitest de Bidule : `npx vitest run extensions/lunar-industries-containers` depuis Bidule) et
`tests/` pour le serveur (`npx vitest run --config tests/vitest.config.ts` depuis ce dossier).
