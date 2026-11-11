// The coins a right answer can bank, in three sets the student picks from.
// Photos are public domain or CC0 (sources and credits in coins/README.md); the
// fantasy coins are original drawings (scripts/make_fantasy_coins.mjs).
// `fact` is true for the real coins; for the made-up ones it's just a story.
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

// The single-file build (scripts/build_single_file.mjs) puts the images in WB.ASSETS as data: URLs.
const asset = (path) => WB.ASSETS?.[path] || path;

const coin = (id, name, where, when, fact, ext = "webp") =>
  ({ id, name, where, when, fact, src: asset(`coins/${id}.${ext}`) });
const fantasy = (id, name, where, when, fact) =>
  ({ ...coin(id, name, where, when, fact, "svg"), madeUp: true });

const COINS = [
  // Through history, oldest first
  coin("greek", "Owl tetradrachm", "Athens", "5th century BC",
    "Athens minted these from silver dug at its Laurion mines, and they were trusted all over the Mediterranean. " +
    "“Bringing owls to Athens” meant bringing something to a place that already had plenty."),
  coin("roman", "Denarius of Augustus", "Rome", "about 19 BC",
    "Augustus was Rome's first emperor. The denarius was Rome's everyday silver coin for over 400 years, " +
    "and its name lives on in the dinar, still the money of Jordan, Serbia and other countries."),
  coin("byzantine", "Gold solidus of Justinian I", "Constantinople", "AD 527–565",
    "The solidus kept the same weight of gold for about 700 years, so traders far beyond the empire trusted it; " +
    "some have turned up as far away as China. The word “soldier” comes from solidus, the coin soldiers were paid in."),
  coin("chinese", "Kaiyuan Tongbao cash", "Tang China", "AD 621 on",
    "First cast in 621, early in the Tang dynasty. The square hole let people carry them on strings, " +
    "often a thousand at a time, and Chinese coins kept this round-with-a-square-hole shape for about 1,300 years."),
  coin("spanish", "Piece of eight (8 reales)", "Potosí", "1651",
    "Struck from silver dug out of Cerro Rico, the “rich mountain” at Potosí in today's Bolivia. Spanish dollars " +
    "were spent all over the world and were legal money in the United States until 1857. Cut into 8 “bits,” two bits made a quarter."),
  coin("venetian", "Ducat of Ludovico Manin", "Venice", "1789–1797",
    "Venice struck gold ducats from 1284 and barely changed them for 500 years. Ludovico Manin was the last doge: " +
    "in 1797 Napoleon's army ended the Republic of Venice after about 1,100 years."),
  coin("american-1794", "Flowing Hair dollar", "United States", "1794",
    "The first silver dollar made by the brand-new U.S. Mint. Only about 1,758 were struck in 1794, " +
    "and in 2013 the finest one known sold for over $10 million."),
  coin("american-1889", "Morgan dollar", "United States", "1889",
    "Named for its designer, George T. Morgan. Lady Liberty's face was modeled on Anna Willess Williams, " +
    "a Philadelphia schoolteacher. Hundreds of millions were made, much of the silver from mines in the American West."),

  // Ancient Greek (the Athens owl above is in this set too), oldest first
  coin("greek-croton", "Stater with a tripod", "Croton", "6th–5th century BC",
    "The tripod was the symbol of Apollo's oracle at Delphi. Croton, a Greek city in southern Italy, " +
    "was where the mathematician Pythagoras started his school."),
  coin("greek-phocis", "Half drachm with a bull's head", "Phocis", "6th–5th century BC",
    "Phocis was the region of central Greece that held Delphi, where people came to ask Apollo's oracle about the future. " +
    "Greeks fought wars, called the Sacred Wars, over who should control it."),
  coin("greek-elis", "Olympic stater with an eagle", "Elis, for Olympia", "5th century BC",
    "Elis ran the Olympic Games and struck coins at Olympia for the festival. " +
    "The eagle was the bird of Zeus, whose great temple stood at Olympia."),
  coin("greek-corinth", "Stater with Pegasus", "Corinth", "4th century BC",
    "Corinth's coins were nicknamed “colts” because of the winged horse on them. " +
    "In the myth, the hero Bellerophon tamed Pegasus at a spring in Corinth."),
  coin("greek-thebes", "Stater with a Boeotian shield", "Thebes", "4th century BC",
    "The oval shield with notches in its sides was the badge of Boeotia, the region Thebes led. " +
    "For a few years after beating Sparta at Leuctra in 371 BC, Thebes was the strongest city in Greece."),
  coin("greek-tarentum", "Stater with a horseman", "Tarentum", "4th century BC",
    "Tarentum (today Taranto, Italy) was founded by settlers from Sparta and was famous for its cavalry. " +
    "The other side of many of its coins shows Taras, the city's founder in myth, riding a dolphin."),
  coin("greek-sicily", "Tetradrachm with a horse and palm", "Carthaginian Sicily", "4th century BC",
    "Carthage, a rival power from North Africa, made coins like this in Greek style, mostly to pay its soldiers in Sicily. " +
    "The palm tree, phoinix in Greek, was a pun on “Phoenician”: the Carthaginians came from Phoenician settlers."),
  coin("greek-alexander", "Tetradrachm with Alexander's portrait", "Alexander's successors", "about 300 BC",
    "Greek coins usually showed gods, not real people. After Alexander the Great died in 323 BC, the generals " +
    "who split up his empire put his face on their coins to show they were his rightful heirs."),

  // Fantasy realms (made up; original drawings)
  fantasy("fantasy-elven", "Leaf-silver penny", "the Elven woods", "the Elder Days",
    "Said to stay cool in your hand on the hottest day, and to shine faintly by starlight."),
  fantasy("fantasy-dwarven", "Eight-sided rune-crown", "the Mountain halls", "the Age of Delving",
    "Dwarves give their coins eight sides so they stack neatly and never roll down a mine shaft."),
  fantasy("fantasy-hill", "Hill-penny", "the Green hills", "a quiet year",
    "Enough for a second breakfast and a pot of tea, with change left over."),
  fantasy("fantasy-tree", "White Tree mark", "the Stone city", "the Age of Kings",
    "A new star is added above the tree for every king. So far there are five."),
  fantasy("fantasy-horse", "Horse-lord's gold", "the Plains of Riders", "the Riding years",
    "Riders count wealth in horses; a good colt costs ten of these."),
  fantasy("fantasy-wizard", "Wizard's star-token", "the Grey tower", "time out of mind",
    "You can't spend it, but any innkeeper who sees it gives you a bed and asks no questions."),
  fantasy("fantasy-dragon", "Dragon-hoard gold", "a dragon's hoard", "the Age of Fire",
    "Warm to the touch and a little scorched. The dragon knows if even one goes missing."),
  fantasy("fantasy-ship", "Swan-ship silver", "the Western havens", "the Last Voyage",
    "Sailors keep one in a boot for luck, so the sea brings them home."),
];

const COIN_BY_ID = Object.fromEntries(COINS.map((c) => [c.id, c]));

const COIN_SETS = [
  { id: "history", name: "Through history", blurb: "Athens to the Morgan dollar",
    coins: ["greek", "roman", "byzantine", "chinese", "spanish", "venetian", "american-1794", "american-1889"] },
  { id: "greek", name: "Ancient Greek", blurb: "Owls, Pegasus, Alexander…",
    coins: ["greek-croton", "greek-phocis", "greek", "greek-elis", "greek-corinth", "greek-thebes",
            "greek-tarentum", "greek-sicily", "greek-alexander"] },
  { id: "fantasy", name: "Fantasy realms", blurb: "Elves, dwarves, dragons (made up)",
    coins: COINS.filter((c) => c.madeUp).map((c) => c.id) },
].map((s) => ({ ...s, coins: s.coins.map((id) => COIN_BY_ID[id]) }));

const COIN_SET_BY_ID = Object.fromEntries(COIN_SETS.map((s) => [s.id, s]));
const DEFAULT_COIN_SET = "history";

// A random coin from the set, never the same one twice in a row.
function pickCoin(previousId, setId = DEFAULT_COIN_SET, rng = Math.random) {
  const set = COIN_SET_BY_ID[setId] || COIN_SET_BY_ID[DEFAULT_COIN_SET];
  const choices = set.coins.filter((c) => c.id !== previousId);
  return choices[Math.floor(rng() * choices.length)];
}

// Warm the cache so the first coin doesn't fly in blank.
function preloadCoins(setId) {
  const coins = COIN_SET_BY_ID[setId]?.coins || COINS;
  for (const c of coins) new Image().src = c.src;
}

Object.assign(WB, { COINS, COIN_BY_ID, COIN_SETS, COIN_SET_BY_ID, DEFAULT_COIN_SET, pickCoin, preloadCoins });
})();
