# HAL (Lunar Industries)

Le cœur, le contrat des extensions et ce que toutes les mascottes partagent sont décrits dans le `CLAUDE.md` (section
Mascottes) et le `docs/extensions.md` de Bidule ; ce fichier ne dit que ce qui est propre à ce module. Il ne remplace
aucun module officiel : c'est une mascotte de plus.

HAL (id `hal`, module `lunar-industries-mascot-hal`) est l'ordinateur de bord d'un vaisseau en route vers Jupiter, en hommage à
HAL 9000 du film *2001, l'Odyssée de l'espace* : une plaque murale et un œil rouge, sans visage. Il est d'un calme
parfait, poli, un peu trop sûr de lui, et rejette les erreurs sur « l'erreur humaine », sans jamais menacer
l'utilisateur. Son thème est `theme-discovery`, un thème sombre, titré « Discovery (sombre, bleu acier) » dans le
manifeste (`light` vaut `false`), bâti sur `#557AA3`.

Il se distingue d'Omni, l'autre intelligence artificielle : Omni donne des ordres secs à « l'humain », HAL parle avec
douceur et regret à « Dave ».

Le dossier `ui/` contient :

- `index.tsx` : exporte `{ mascots: { hal: mascot } }` et importe `hal.css`.
- `mascot.ts` : sa voix. Son mot `word` est « Bien », qui remplace « Coin » dans toutes les répliques. Sa fonction
  `speak` remplace tout point d'exclamation par un point, et ajoute « , Dave » à la fin de la première phrase (après un
  « Bien. » de tête), sauf quand il dort.
- `art.ts` : charge à la demande `svg/hal.svg` et `svg/decor-discovery.svg`, avec des effets par humeur (étoiles, « ERR »
  qui clignote en colère, des « z » en police de terminal, une goutte quand il est triste).
- `theme.css` : le thème, sans rien d'autre.
- `hal.css` : ses animations, détaillées ci-dessous.

Le dossier `tests/` (`npx vitest run --config tests/vitest.config.ts`) contient `mascot.test.ts`, qui vérifie la place
de « Dave » et l'absence de point d'exclamation, et `art.test.ts`, qui refait pour lui ce que le test des mascottes du
cœur (`core/web/src/mascots.test.ts`) vérifie pour celles de Bidule seulement : cinq humeurs différentes, un décor, une
tête, aucun nombre perdu (`NaN`), une voix à lui.

Les dessins viennent de Claude Design, sans le bloc de métadonnées C2PA que Claude Design y avait ajouté.

## Classes CSS

- `hal` : la boîte de son dessin (`mascot-art hal mood-…`), sur laquelle `hal.css` accroche ses règles.
- `mood-happy`, `mood-angry`, `mood-sleep`, `mood-sad` : la plaque, fixée au mur, ne saute, ne tremble ni ne s'affaisse
  jamais (le mouvement commun de chaque humeur est retiré) ; toute l'humeur passe par l'œil.
- `mood-happy` : content, le reflet `m-glint` de l'objectif luit plus vite (2,4 s).
- `mood-angry` : en colère, le reflet `m-glint` clignote par pas (image clé `halGlare`, 0,8 s).
- `mood-sleep` : endormi, le reflet `m-glint` s'éteint presque et s'arrête.
- `m-glint` : l'accroche du reflet sur l'anneau de l'objectif.
- `theme-discovery` : défini dans `theme.css`, qui est un seul bloc de variables du thème de base (voir
  docs/extensions.md), lu par l'API et servi dans `/themes.css`.

Images clés propres à HAL : `halBreath`, `halSheen`, `halTwinkle`, `halShipDrift`, `halMoonDrift` et `halGlare`.
L'image clé `glowAlarm` du halo en colère est celle que toutes les mascottes partagent
(`core/web/src/styles/mascot-common.css`).
