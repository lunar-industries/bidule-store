# Lunar Industries : un store de modules pour Bidule

Ce dépôt public est le store de Lunar Industries pour [Bidule](https://github.com/verhaegheteddy/bidule). Il propose
les modules `lunar-industries-*`, qui concurrencent des modules officiels de Bidule (Kanban, Branches, Temps, Claude,
Conteneurs, Terminal) avec leur propre id ; leur nom est celui du module qu'ils remplacent. Ce n'est pas le store de Bidule : ses paquets sont signés par la clé de ce store, et
Bidule les marque « Communautaire · Lunar Industries ». Plane (`lunar-industries-plane`) n'en remplace aucun : il
fournit les tâches Plane à côté de celles de Notion.

- `index.json`, sur la branche `main` : l'index du store, que Bidule lit.
- Les releases `<id>-<version>` : les paquets signés de chaque version d'un module.
- `extensions/<id>` : les sources des modules.

## Ajouter ce store dans Bidule

Dans Réglages › Stores, « Ajouter un store », avec :

- le nom : `Lunar Industries` ;
- l'adresse de l'index : `https://raw.githubusercontent.com/lunar-industries/bidule-store/main/index.json` ;
- la clé publique :

  ```
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEAAlodwhEpD729b8IuSYKpXsGO3wLfo9cQZfqT2QARcoM=
  -----END PUBLIC KEY-----
  ```

L'empreinte de cette clé est `SHA256:wrC7OJl9hufN6AXZApt2ejhePZiFis/CIfT7J1YzOfA`. Quand Bidule suggère ce store
(sous « Stores suggérés par Bidule »), il montre cette empreinte : comparez-la avant de l'ajouter.

Un module de ce store remplace un module officiel : désactivez l'officiel dans Réglages › Extensions avant
d'installer le module Lunar Industries qui le remplace.

Le Terminal (`lunar-industries-terminal`, dessiné par ghostty-web) est l'exception : il fournit le rôle `terminal`
comme l'officiel, et Bidule refuse de désactiver le seul terminal tant que des extensions en ont besoin (Claude,
Docker). Installez-le d'abord, puis choisissez-le dans Réglages › Rôles et redémarrez Bidule. Tant qu'aucun des deux
n'est choisi, aucun ne tient le rôle, et les extensions qui en ont besoin sont en erreur.

## Passer du store de Bidule à celui-ci

Les premières versions des modules `lunar-industries-*` ont été publiées par le store de Bidule. Un module installé
depuis ce store-là y reste attaché : il ne reçoit plus de mises à jour une fois retiré de son index, et Bidule ne le
fait pas passer à un autre store sans votre accord. Pour le reprendre depuis ce store-ci : retirez-le dans Réglages ›
Extensions, redémarrez Bidule, puis installez-le depuis ce store. Le retrait n'enlève que le dossier du paquet : les
tables, les réglages et les secrets du module restent, et le module les retrouve.

## Travailler sur les modules

Les modules se construisent avec le code de Bidule. Clonez ce dépôt dans un checkout de Bidule, sous le nom
`bidule-store/`, puis liez ses modules :

```sh
git clone git@github.com:lunar-industries/bidule-store.git bidule-store
npm run store:link
```

Les tests d'un module se lancent depuis son dossier :
`npx vitest run --config tests/vitest.config.ts`. Le test de contrat, `sh bidule-store/scripts/check-host.sh` depuis
la racine de Bidule, fait tourner `tests/host.spec.ts` dans l'hôte d'extensions réel du cœur : il vérifie que chaque
module y est chargé sans erreur, qu'il démarre, et que le cœur ne refuse aucun de ses réglages.

## Publier une version

Le workflow `.github/workflows/publication.yml` publie les modules. Pour publier la version d'un module, montez sa
version dans son `bidule.json` et son `package.json`, poussez ce commit sur `main`, puis poussez un tag qui nomme le
module et cette version :

```sh
git tag lunar/lunar-industries-temps@0.4.0
git push origin lunar/lunar-industries-temps@0.4.0
```

- `lunar/<id>@<version>` publie ce module ; la version du tag doit être celle de son `bidule.json`.
- `lunar/<id>@<version>-<n'importe quoi>` publie à nouveau la même version, avec des paquets reconstruits (pour
  ajouter un système qui lui manquait, par exemple).
- `lunar/all@<date>` publie chaque module dont la version n'est pas encore dans l'index.
- À la main, dans Actions › Publication › Run workflow : un id ou `all`, et la branche de Bidule avec laquelle
  construire.

Le code de Bidule est privé : le workflow clone le fork `lunar-industries/bidule` avec une clé de déploiement en
lecture seule (sa branche `main`, ou celle donnée à la main), puis copie les modules de ce dépôt dans ce checkout.
Il y choisit le Terminal de ce store pour le rôle `terminal` (`scripts/ci-choices.sh`), comme un utilisateur le ferait
dans Réglages › Rôles : sans ce choix, les extensions qui exigent le rôle seraient en erreur, et Bidule ne générerait
pas leur client typé. Avant de construire quoi que ce soit, il lance les tests de chaque module publié, le typecheck de Bidule avec les
modules, et le test de contrat. Ensuite, il construit et signe chaque paquet avec `scripts/pack-extension.mjs` de
Bidule, vérifie avec `scripts/store-index.mjs --check` qu'une version déjà publiée garde son manifeste, dépose le
paquet dans la release `<id>-<version>` de ce dépôt, et écrit enfin l'entrée dans `index.json` sur `main`. Un module
qui embarque du code propre à un système (une bibliothèque native, ou le Claude Code de l'Agent SDK) reçoit un paquet
par système : Linux, Windows et macOS.

Une seule publication tourne à la fois, et GitHub ne garde qu'une seule publication en attente derrière elle : si
l'on pousse plusieurs tags d'affilée, les publications en attente de trop sont annulées sans message. Pour publier
plusieurs modules, poussez un seul tag `lunar/all@<date>`, ou attendez la fin d'une publication avant de pousser le
tag suivant.

Ce que le workflow attend de la branche de Bidule avec laquelle il construit (le `main` du fork privé, pour un tag) :
`scripts/ci-env.mjs` (arrivé avec les vérifications de CI de Bidule) et l'option `--check` de
`scripts/store-index.mjs` (arrivée avec le refus d'un manifeste changé). Tant que le `main` du fork n'est pas
synchronisé avec celui de Bidule, le workflow s'arrête au début avec un message qui le dit.

La première publication se fait dans cet ordre :

1. synchroniser le `main` du fork privé `lunar-industries/bidule` avec celui de Bidule (cœur 0.2.1 publié) ;
2. pousser le workflow et les modules sur `main` de ce dépôt ;
3. pousser un tag `lunar/all@<date>` ;
4. vérifier dans Actions que la publication passe, que les releases portent les paquets et que `index.json` les
   liste ;
5. ajouter ce store dans Bidule (Réglages › Stores) et installer un module ;
6. ensuite seulement, proposer au store de Bidule de retirer les modules de son index et de suggérer ce store.

Les journaux de ce workflow sont publics, comme ce dépôt. Quand une étape échoue, ils peuvent montrer des chemins et
des messages du code privé de Bidule (un avertissement de compilation, une erreur de test) : c'est accepté.

Secrets du dépôt : `BIDULE_SIGNING_KEY`, la clé privée ed25519 de ce store (format PEM), et `BIDULE_DEPLOY_KEY`, la
clé SSH privée de déploiement du fork `lunar-industries/bidule`. La clé privée du store ne doit jamais être perdue :
sans elle, aucune mise à jour ne pourrait plus être signée, et une nouvelle clé obligerait chacun à retirer puis à
rajouter le store.

Le guide pour tenir un store est celui du store de Bidule :
[docs/creer-un-store.md](https://github.com/verhaegheteddy/bidule-store/blob/main/docs/creer-un-store.md).
