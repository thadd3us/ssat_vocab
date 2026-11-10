# Coins

All from Wikimedia Commons, all **public domain** or **CC0** (no attribution required; credited anyway).
Each is the 330 px Commons thumbnail with the background flood-filled away from the corners,
trimmed, and fit into 200×200 WebP:

    magick in.jpg -alpha set -fuzz 12% -fill none -draw "color 0,0 floodfill" (…and the other three corners) \
      -channel A -morphology Open Disk:4 +channel -trim +repage \
      -resize 200x200 -background none -gravity center -extent 200x200 -quality 82 out.webp

Fuzz was 6–22% depending on the background.

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
