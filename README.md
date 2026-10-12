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

Le guide pour tenir un store est celui du store de Bidule :
[docs/creer-un-store.md](https://github.com/verhaegheteddy/bidule-store/blob/main/docs/creer-un-store.md).
