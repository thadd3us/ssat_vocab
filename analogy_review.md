# Analogy review: blind pass

I answered all 1,039 analogies blind, one per word in `web/ssat_vocab.jsonl` (main @ 0390191). Each question was shown as `A : B :: C : ?` with the answer and **all four** curated distractors, shuffled. That is a little harder than the app, which shows 3 curated distractors plus 1 random word. I didn't see the relation, rule or key until after grading.

- **Correct:** 1,022 of 1,039 (98.4%)
- **Wrong:** 17
- **Flagged unsure while answering:** 46 (29 of them turned out right)

Full sheet: [analogy_blind_answers.tsv](analogy_blind_answers.tsv). It records the questions *before* the fixes below.

## Status: fixes applied to `web/ssat_vocab.jsonl`

- The 16 wrong items (all except 753, which was my own error) and the 14 ambiguous items now have a single right answer. Distractors were dropped or swapped. Rectitude now takes **sinner**, and maelstrom takes **air**. Multifarious was rebuilt as "multifarious : many kinds :: monotonous : one tone".
- The 7 weak relationships were replaced:
  - conscientious : finish :: negligent : forget
  - contrite : apologize :: defiant : refuse
  - dainty : sip :: greedy : gulp
  - compunction : misdeed :: gratitude : favor
  - precedent : judge :: blueprint : builder
  - leery : trust :: reluctant : agree
  - valiant : knight :: cowardly : deserter
- Negligent was also rebuilt, as "negligent : care :: ignorant : knowledge".
- The odd-one-out giveaway is gone from 298 opposites/same-meaning items. Each now has 2 traps that fit the *wrong* relation (e.g. a synonym of C in an opposites item) plus 2 near-misses on the answer's side, some of them sound-alike or other-meaning traps (detractor → *tractor*, berate → *loud*). The app shows 3 of the 4, so every question has at least one of each kind. Example: tedious → boring / dull / noisy / friendly / **exciting**.
- Left as is: anterior, perennial, virtuoso and disingenuous, which already had mixed distractors.

## Wrong: fix these

| # | Word | Question | Key | My pick | Problem / suggested fix |
|---|---|---|---|---|---|
| 241 | obsequious | obsequious : servant :: domineering : ? | tyrant | master | servant/master is the natural pair. Drop the "master" distractor. |
| 505 | rectitude | rectitude : saint :: iniquity : ? | villain | sinner | Saint/sinner is the natural pair. Make **sinner** the answer and drop "villain". |
| 687 | multifarious | multifarious : uniform :: many : ? | one | few | "Few" is the usual opposite of "many". Drop "few", or rework the item. |
| 404 | subordinate | subordinate : boss :: private : ? | general | sergeant | A private answers to a sergeant first. Drop "sergeant". |
| 284 | privation | privation : necessities :: drought : ? | rain | water | Both fit. Drop "water". |
| 542 | virtuoso | novice : virtuoso :: beginner : ? | master | expert | Both fit. Drop "expert". |
| 384 | pragmatic | pragmatic : idealistic :: practical : ? | dreamy | romantic | romantic, dreamy and quixotic all fit. Needs new distractors. |
| 428 | tentative | tentative : pencil :: permanent : ? | ink | pen | pen, ink and marker all fit. Needs new distractors. |
| 722 | charlatan | charlatan : doctor :: counterfeit : ? | bill | money | bill, coin and money all fit. Needs new distractors. |
| 231 | parochial | parochial : village :: cosmopolitan : ? | city | world | "World" is arguably the better answer. Drop "world". |
| 831 | maxim | maxim : wisdom :: pun : ? | wordplay | humor | Both fit. Drop "humor" (and maybe "joke"). |
| 774 | malapropism | malapropism : word :: typo : ? | letter | spelling | "Spelling" is close. Drop it. |
| 779 | hegemony | hegemony : empire :: monopoly : ? | company | market | A monopoly is held by a company *over* a market. Drop "market". |
| 772 | umbrage | insult : umbrage :: gift : ? | delight | thanks | "Take delight" mirrors "take umbrage", which is clever but subtle. Drop "thanks". |
| 632 | maelstrom | maelstrom : sea :: tornado : ? | sky | wind | A tornado is a whirl of wind more than "in the sky". Drop "wind", or use "air" as the answer. |
| 953 | negligent | negligent : neglect :: diligent : ? | diligence | care | The relation is shaky: the noun for negligent is negligence, and "care" fits as well. Rework. |
| 753 | officious | officious : meddle :: reticent : ? | withdraw | speak | My mistake: "speak" is a fair trap. **Leave it.** |

## Right, but ambiguous: also fix

Two or more options are defensible in each of these:

| # | Question | Key | Also fits |
|---|---|---|---|
| 799 | disingenuous : insincere :: candid : ? | frank | open, honest |
| 185 | ramp : facilitate :: barricade : ? | obstruct | block |
| 685 | diurnal : eagle :: nocturnal : ? | owl | bat |
| 281 | renounce : throne :: resign : ? | post | office |
| 855 | novice : apprentice :: veteran : ? | master | expert |
| 256 | senescent : elderly :: juvenile : ? | young | youthful |
| 354 | apprehension : exam :: anticipation : ? | holiday | vacation |
| 262 | parody : mock :: tribute : ? | honor | praise |
| 807 | fortuitous : chance :: deliberate : ? | design | plan |
| 914 | chronic : years :: acute : ? | days | weeks (and an acute illness can last weeks) |
| 344 | patron : artist :: sponsor : ? | athlete | team |
| 378 | malady : doctor :: dispute : ? | mediator | judge |
| 314 | enmity : foes :: amity : ? | friends | allies |
| 647 | inert : motion :: mute : ? | speech | sound, voice |

## Weak relationships (the pairs feel forced)

- **992** conscientious : homework :: negligent : excuses
- **997** contrite : apology :: defiant : excuse
- **1036** dainty : teacup :: clumsy : mug (a mug is sturdy, not clumsy)
- **380** compunction : conscience :: pain : nerve
- **405** precedent : court :: rehearsal : performance
- **671** leery : stranger :: trusting : friend ("con man" is a confusing distractor)
- **906** valiant : knight :: cowardly : lion (only works if you know *The Wizard of Oz*)

## Bigger pattern: odd one out gives away the answer

The "opposites" items (133) and "same meaning" items (169) make up about 29% of the set. In most of them, the four distractors are all synonyms of C and the answer is the only antonym, or the other way round. Example:

> prosaic : imaginative :: tedious : ?  — dull / monotonous / boring / tiresome / **exciting**

You can answer that without knowing what "prosaic" means. Real SSAT analogies mix in distractors from other relations, and from the stem's own words, so you have to work out A : B. Possible fixes:

- In opposites items, make one or two distractors a *different* antonym-flavored word that fits a different relation.
- Or move these word pairs to the Synonym and Antonym modes, and keep Analogies for relational items: "who does what", "lacking", cause and effect, "mild and extreme forms".

The relational items were the strongest part of the set, e.g. "inevitable : avoided :: indelible : erased" and "ship : founder :: plane : crash".
