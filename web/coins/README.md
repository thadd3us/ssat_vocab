# Coins

All from Wikimedia Commons, all **public domain** or **CC0** (no attribution required; credited anyway).
Each is the 330 px Commons thumbnail with the background flood-filled away from the corners,
trimmed, and fit into 200×200 WebP:

    magick in.jpg -alpha set -fuzz 12% -fill none -draw "color 0,0 floodfill" (…and the other three corners) \
      -channel A -morphology Open Disk:4 +channel -trim +repage \
      -resize 200x200 -background none -gravity center -extent 200x200 -quality 82 out.webp

Fuzz was 6–22% depending on the background. (`greek-corinth` also had 12 px shaved off first, to drop the tilted white scan border.)

| File | Coin | License | Source |
|---|---|---|---|
| `greek.webp` | Athens, owl tetradrachm (reverse), 5th c. BC | CC0 | Cleveland Museum of Art 1941.296.b, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Athens,_5th_century_BC_-_Tetradrachm-_Owl_(reverse)_-_1941.296.b_-_Cleveland_Museum_of_Art.tif) |
| `roman.webp` | Silver denarius of Augustus | CC0 | American Numismatic Society 1944.100.39031, [Commons](https://commons.wikimedia.org/wiki/File:Silver_Denarius_of_Augustus_(MANTIS).jpg) |
| `byzantine.webp` | Gold solidus of Justinian I (527–565) | CC0 | Metropolitan Museum of Art, [Commons](https://commons.wikimedia.org/wiki/File:Gold_Solidus_of_Justinian_I_(527%E2%80%9365)_MET_DP100644.jpg) |
| `chinese.webp` | Kaiyuan Tongbao, Tang dynasty | Public domain | Zhuwq on zh.wikipedia, [Commons](https://commons.wikimedia.org/wiki/File:KaiyuanTongbao.png) |
| `spanish.webp` | 8 reales, Potosí, 1651 (obverse) | CC0 | Reinhard Saczewski, Münzkabinett der Staatlichen Museen zu Berlin, [Commons](https://commons.wikimedia.org/wiki/File:8_reales_de_1651_(Potos%C3%AD)_-_anverso.jpg) |
| `venetian.webp` | Venetian ducat of Ludovico Manin (San Marco side) | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Ducatus_Venetus,_Venetian_ducat,_of_the_reign_of_Ludovicus_Manin_Dux_(San_Marco_side).jpg) |
| `american-1794.webp` | Flowing Hair dollar, 1794 | Public domain | U.S. Mint / Smithsonian National Numismatic Collection, [Commons](https://commons.wikimedia.org/wiki/File:Flowing_hair_dollar.jpeg) |
| `american-1889.webp` | Morgan dollar, 1889 | Public domain | Scan by Gore2000, [Commons](https://commons.wikimedia.org/wiki/File:1889-P_Morgan_dollar_obverse_(transparent).png) |
| `greek-croton.webp` | Croton, stater with a tripod (obverse), 6th–5th c. BC | CC0 | Cleveland Museum of Art 1916.985.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Croton,_6th-5th_century_BC_-_Stater-_Tripod_(obverse)_-_1916.985.a_-_Cleveland_Museum_of_Art.jpg) |
| `greek-phocis.webp` | Phocis, half drachm with a bull's head facing (obverse), 6th–5th c. BC | CC0 | Cleveland Museum of Art 1916.983.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Phocis,_6th-5th_century_BC_-_Half_Drachm-_Bull%27s_Head_Facing_(obverse)_-_1916.983.a_-_Cleveland_Museum_of_Art.jpg) |
| `greek-elis.webp` | Elis, Olympic stater with an eagle on an olive branch (obverse), 5th c. BC | CC0 | Cleveland Museum of Art 1916.995.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Elis_for_Olympic_Festivals,_5th_century_BC_-_Stater-_Eagle_with_Spread_Wings_on_Olive_Branch_(obverse)_-_1916.995.a_-_Cleveland_Museum_of_Art.jpg) |
| `greek-corinth.webp` | Corinth, stater with Pegasus (obverse), 4th c. BC | CC0 | Cleveland Museum of Art 1916.984.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Corinth,_4th_century_BC_-_Stater-_Pegasus_(obverse)_-_1916.984.a_-_Cleveland_Museum_of_Art.jpg) |
| `greek-thebes.webp` | Thebes, stater with a Boeotian shield (obverse), 4th c. BC | CC0 | Cleveland Museum of Art 1941.295.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Boeotia,_Thebes,_4th_century_BC_-_Stater-_Boeotian_Shield_in_High_Relief_(obverse)_-_1941.295.a_-_Cleveland_Museum_of_Art.tif) |
| `greek-tarentum.webp` | Tarentum, stater with a horseman (obverse), 4th c. BC | CC0 | Cleveland Museum of Art 1916.987.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_Tarentum,_4th_century_BC_-_Stater-_Naked_Horseman_with_Spears_and_Shield_(obverse)_-_1916.987.a_-_Cleveland_Museum_of_Art.tif) |
| `greek-sicily.webp` | Sicily, tetradrachm with a horse and palm tree, 4th c. BC (the museum's title says Persephone; that's the other side) | CC0 | Cleveland Museum of Art 1917.980.b, [Commons](https://commons.wikimedia.org/wiki/File:Sicily,_Greece,_4th_century_BC_-_Tetradrachm-_Persephone_(reverse)_-_1917.980.b_-_Cleveland_Museum_of_Art.jpg) |
| `greek-alexander.webp` | Tetradrachm with Alexander the Great (obverse), 4th–3rd c. BC | CC0 | Cleveland Museum of Art 1917.984.a, [Commons](https://commons.wikimedia.org/wiki/File:Greece,_4th_century_BC_-_Tetradrachm-_Alexander_the_Great_(obverse)_-_1917.984.a_-_Cleveland_Museum_of_Art.tif) |

## Fantasy coins

`fantasy-*.svg` are original drawings made by [`scripts/make_fantasy_coins.mjs`](../../scripts/make_fantasy_coins.mjs):
no art, symbols or lettering copied from any book or film. The marks round the edge are made-up runes.
Edit the script and re-run it (`node scripts/make_fantasy_coins.mjs`) rather than editing the SVGs.
