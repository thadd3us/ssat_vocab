# Sounds

`kaching.wav` is trimmed from
["cash register old antique open close drawer with bell ring various combinations.wav"](https://freesound.org/people/kyles/sounds/452572/)
by kyles on Freesound, released under **CC0 1.0** (public domain dedication; no attribution required,
credited here anyway).

Made from the site's high-quality MP3 preview: 69.56–71.80 s (key-lever rush, bell strike, drawer slam),
60 Hz high-pass, 10 ms fade-in, 0.5 s fade-out, +1 dB to peak at about −1 dBFS:

    ffmpeg -ss 69.56 -to 71.80 -i register.wav \
      -af "highpass=f=60,afade=t=in:d=0.01,afade=t=out:st=1.74:d=0.5,volume=1dB" \
      -c:a pcm_s16le -ar 48000 -ac 1 kaching.wav

The strike at about 62.7 s in the same recording is a good alternative.

The page plays it from `kaching.js`, a base64 `data:` URL of this file (a page opened from disk can't
fetch the `.wav`). After changing `kaching.wav`, run `scripts/embed_assets.sh`.

`words/<word>.mp3` is each word said aloud, recorded by `scripts/make_pronunciations.mjs` (Google
Translate's voice by default; see the main README), and `pronunciations.js` wraps them all as data: URLs.
