# Gerty (Lunar Industries)

Le cœur, le contrat des extensions et ce que toutes les mascottes partagent sont décrits dans le `CLAUDE.md` (section
Mascottes) et le `docs/extensions.md` de Bidule ; ce fichier ne dit que ce qui est propre à ce module. Il ne remplace
aucun module officiel : c'est une mascotte de plus.

Gerty (id `gerty`, module `lunar-industries-mascot-gerty`) est un robot assistant suspendu au rail d'une base lunaire, en hommage à
GERTY 3000 du film *Moon*. Son visage est une frimousse jaune sur un écran. Il est bienveillant, s'inquiète pour
l'utilisateur et ne s'exclame jamais. Son thème est `theme-moonbase`, un thème clair, titré « Base lunaire (clair, bleu
acier) » dans le manifeste (`light` vaut `true`), bâti sur `#557AA3`.

Le dossier `ui/` contient :

- `index.tsx` : exporte `{ mascots: { gerty: mascot } }` et importe `gerty.css`.
- `mascot.ts` : sa voix. Son mot `word` est « Pling », qui remplace « Coin » dans toutes les répliques. Sa fonction
  `speak` remplace tout point d'exclamation par un point, et ajoute « :) » à la fin d'une réplique heureuse (mode
  `quack`).
- `art.ts` : charge à la demande `svg/gerty.svg` et `svg/decor-moonbase.svg`, avec des effets par humeur (cœur jaune et
  étoile, goutte de sueur et « ? » quand il s'inquiète, zzz, larme).
- `theme.css` : le thème, sans rien d'autre.
- `gerty.css` : ses animations, détaillées ci-dessous.

Son bras monte au-dessus de sa boîte de dessin (jusqu'à `y = -280` dans son `viewBox`), comme s'il pendait de son rail.

Le dossier `tests/` (`npx vitest run --config tests/vitest.config.ts`) contient `mascot.test.ts`, qui vérifie qu'il ne
s'exclame jamais et que « :) » n'est ajouté qu'une fois, après une bonne nouvelle, et `art.test.ts`, qui refait pour lui
ce que le test des mascottes du cœur (`core/web/src/mascots.test.ts`) vérifie pour celles de Bidule seulement : cinq
humeurs différentes, un décor, une tête, aucun nombre perdu (`NaN`), une voix à lui.

Les dessins viennent de Claude Design, sans le bloc de métadonnées C2PA que Claude Design y avait ajouté.

## Classes CSS

- `gerty` : la boîte de son dessin (`mascot-art gerty mood-…`), sur laquelle `gerty.css` accroche ses règles.
- `mood-happy` : content, il se balance sur son rail (image clé `gertySwing`, 1,4 s, une fois) au lieu de sauter, et
  ses voyants `m-led` clignotent plus vite (0,9 s).
- `mood-angry` : inquiet, ses voyants `m-led` clignotent vite (0,45 s) et sa caméra `m-cam` balaie plus vite (2,2 s).
- `mood-sleep` : endormi, ses voyants `m-led` s'atténuent et s'arrêtent, comme sa caméra `m-cam`.
- `m-led` : l'accroche de ses trois voyants.
- `m-cam` : l'accroche de l'objectif de sa caméra, qui balaie de gauche à droite.
- `theme-moonbase` : défini dans `theme.css`, qui est un seul bloc de variables du thème de base (voir
  docs/extensions.md), lu par l'API et servi dans `/themes.css`.

Images clés propres à Gerty : `gertyLed`, `gertyCamPan`, `gertyLamp`, `gertyEarthTurn` et `gertySwing`. Les autres sont
celles que toutes les mascottes partagent (`core/web/src/styles/mascot-common.css`).
