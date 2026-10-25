# Branches (Lunar Industries)

Le cœur et le contrat des extensions sont décrits dans le `CLAUDE.md` et le `docs/extensions.md` de Bidule ; ce
fichier ne dit que ce qui est propre à ce module. Sa page est `/lunar-industries/branches`, reprise de la page Branches
de quack-board (Simon) et dessinée d'après la maquette « Branches Lunar » (Claude Design), piste C : un tableau dense,
le détail dans un tiroir.

## Le serveur (`server/`)

Les branches, leur tâche et les réglages partagés (branches d'intégration, cibles des revues, nommage) viennent de
`lunar-industries-common`, par ses commandes. Le service (`server/service.ts`) y ajoute ce que le cœur sait de plus :
la branche est-elle sur origin au même commit (`pushed`), ses commits d'avance (`ahead`), sa dernière revue est-elle
un brouillon (`reviewDraft`). Les écritures passent par le client de la forge (`review.forge`) : ouvrir une revue en
brouillon, la sortir du brouillon, la fusionner, lancer ou relancer un pipeline, lancer un job manuel ; chacune est
suivie de `review.refresh` sur la branche. Pousser passe par git (`git.push`, jamais forcé) ; un refus d'origin rend
les mots de git. `server/issue_links.ts` lie d'office une branche à la tâche de l'issue que son nom cite. Les routes
sont listées dans `contract.ts`.

## La page (`ui/BranchesPage.tsx`)

- **Au bord du bandeau** : la recherche (`ToolSearch`, dans le nom, le dépôt, le titre ou la référence de la tâche) et
  le filtre (`ToolFilter` : « En cours », « Sans tâche », « Toutes », fusionnées comprises).
- **Le tableau** : une ligne par branche, groupée par dépôt (en-tête repliable, qui dit combien de branches attendent
  quelque chose de toi). Colonnes : Branche, Tâche, État (la frise et l'état en mots, `stateOf`), Revue, CI, Commit,
  Action (l'action principale, `actionOf`, au même endroit sur chaque ligne). Un point de couleur marque les lignes qui
  attendent quelque chose de toi. Tri par Branche, État (ce qui t'attend d'abord, `sortRows`) ou Commit.
- **Le clavier** : un seul arrêt de Tab pour le tableau ; ↑ ↓ Début Fin changent de ligne, Entrée ouvre le tiroir,
  Échap le ferme et rend le focus au tableau, la touche Menu ou Maj+F10 ouvrent le menu de la ligne (le menu commun de
  `lunar-industries-common`, aussi au clic droit et au « ⋯ » du tiroir). Les raccourcis sont déclarés dans le manifeste.
- **Le tiroir** (`Drawer`) : le panneau latéral commun (`SidePanel` de `lunar-industries-common`), par-dessus le
  tableau : l'ouvrir ou le fermer ne déplace rien. Échap ou sa × rendent le focus au tableau, sur la ligne qui était
  ouverte, sans le faire défiler. Un clic en dehors le ferme, sauf sur une ligne du tableau (qui l'ouvre à cette
  ligne). Les flèches du tableau le font suivre la ligne choisie. Il montre la frise (étapes faites, en cours, à
  venir), trois cases (revue, CI, origin), les tâches de la branche, chacune avec « Délier » (une tâche inconnue est
  dite par le début de son identifiant), puis le champ qui en ajoute une (`TaskField` commun, « Tâche » tant qu'elle
  n'en a pas, « Ajouter une tâche » ensuite, qui cherche aussi dans le nom des branches liées et laisse de côté celles
  qu'elle a déjà) : une branche peut servir plusieurs tâches, et le tableau montre la première et le nombre des
  autres. Le tiroir montre ensuite l'étape à faire (`NextStep` : pousser puis créer la revue brouillon vers la « Branche cible », les jobs en échec d'une CI rouge et les relancer, sortir du
  brouillon, fusionner) et les autres actions (voir la revue, le pipeline, l'issue, lancer un pipeline, les jobs
  manuels par le menu commun). « Lecture de la forge… » pendant que les liens sont lus, l'erreur avec Réessayer s'ils
  ne le sont pas.
- **Les écritures** sont toutes confirmées par une phrase complète (`confirm` commun), l'attente montrée par `busy` du
  SDK, puis le tableau relu.
- **Les états** (`Loading`, `Alert`, `Empty` communs) : « Lecture des dépôts… » au chargement ; une relecture qui
  échoue garde le tableau et met l'erreur au-dessus ; une recherche sans résultat propose « Effacer la recherche ».
  Les tâches sont lues par `useTaskBoard` : une lecture qui échoue est dite dans le champ Tâche, avec Réessayer. Tant que l'état réel d'une revue n'est pas
  connu, la branche dit « Revue ouverte », pas « Prête à fusionner ».
- **La fenêtre étroite** (moins de 1 000 px) : le tableau garde la branche (sa tâche dessous), l'état et l'action.
- **La mascotte** dit d'abord « La CI de X est rouge », sa réplique taquine ensuite (`hintOf`).
- **La partie de fond** (`ui/index.tsx`) relit les branches quand git relit les dépôts, quand une tâche ou une branche
  change (une liaison) ou quand une forge lit une revue ou une CI. Elle notifie une CI qui passe au rouge (`turnedRed` : une fois par
  pipeline, la première lecture ne faisant que retenir), fenêtre au second plan ; un clic ouvre la branche
  (`ui/state.ts`, `openBranch`).

Ce qui se calcule sans rien dessiner est dans `ui/steps.ts`, testé dans `tests/steps.test.ts`.

## Classes CSS

Toutes dans `ui/branches.css`, sous `lib-` :

- La page : `lib-page` (`narrow`), `lib-main`.
- Le tableau : `lib-table-panel`, `lib-table`, `lib-sort`, `lib-group-row`, `lib-group-fold`, `lib-chevron`,
  `lib-group-name`, `lib-row` (`active`, `open`), `lib-col-dot`, `lib-dot` (`data-tone`), `lib-branch`, `lib-name`,
  `lib-sub`, `lib-col-task`, `lib-col-extra`, `lib-col-action`, `lib-state`, `lib-state-text` (`data-tone`),
  `lib-progress`, `lib-ci` (`data-ci`).
- Le contenu du tiroir : `lib-facts`, `lib-task`, `lib-steps`, `lib-step` (`done`, `current`, `todo`),
  `lib-step-track`, `lib-step-mark`, `lib-step-label`, `lib-next`, `lib-next-text`, `lib-next-actions`, `lib-target`,
  `lib-failed`, `lib-actions`.

## Tests

`tests/` (Vitest, dans Node) : `npx vitest run --config tests/vitest.config.ts` depuis ce dossier.
