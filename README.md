# Lunar Industries : un store de modules pour Bidule

Ce dépôt public est le store de Lunar Industries pour [Bidule](https://github.com/verhaegheteddy/bidule). Il propose
les modules `lunar-industries-*`, qui concurrencent des modules officiels de Bidule (Kanban, Branches, Temps, Claude,
Conteneurs) avec leur propre id. Ce n'est pas le store de Bidule : ses paquets sont signés par la clé de ce store, et
Bidule les marque « Communautaire · Lunar Industries ».

- `index.json`, sur la branche `main` : l'index du store, que Bidule lit.
- Les releases `<id>-<version>` : les paquets signés de chaque version d'un module.
- `extensions/<id>` : les sources des modules.

## Ajouter ce store dans Bidule

Dans Réglages › Extensions › Stores, « Ajouter un store », avec :

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
Avant de construire quoi que ce soit, il lance les tests de chaque module publié, le typecheck de Bidule avec les
modules, et le test de contrat. Ensuite, il construit et signe chaque paquet avec `scripts/pack-extension.mjs` de
Bidule, vérifie avec `scripts/store-index.mjs --check` qu'une version déjà publiée garde son manifeste, dépose le
paquet dans la release `<id>-<version>` de ce dépôt, et écrit enfin l'entrée dans `index.json` sur `main`. Un module
qui embarque du code propre à un système (une bibliothèque native, ou le Claude Code de l'Agent SDK) reçoit un paquet
par système : Linux, Windows et macOS. Une seule publication tourne à la fois.

Secrets du dépôt : `BIDULE_SIGNING_KEY`, la clé privée ed25519 de ce store (format PEM), et `BIDULE_DEPLOY_KEY`, la
clé SSH privée de déploiement du fork `lunar-industries/bidule`. La clé privée du store ne doit jamais être perdue :
sans elle, aucune mise à jour ne pourrait plus être signée, et une nouvelle clé obligerait chacun à retirer puis à
rajouter le store.

Le guide pour tenir un store est celui du store de Bidule :
[docs/creer-un-store.md](https://github.com/verhaegheteddy/bidule-store/blob/main/docs/creer-un-store.md).
