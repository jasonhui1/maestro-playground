# Gacha designer tuning — 2026-10-02

`workspace/agents/creative/gacha-designer.md` started as a copy of
`anime-designer.md`. Explorations 1, 3 and 4 go to both agents once kept;
exploration 2 (star rarity) is gacha-designer only. Text only: no image calls.

## Method

- Engine at localhost:3000, model gpt-6-luna (env override), both agents.
- Two roll sets of 8, rolled once by the engine's own `rollDice`, one role
  pinned per card so each batch mixes roles:
  - b1: knight, idol, assassin, chef, mechanic, witch, DJ, shrine maiden
  - b2: knight, idol, bounty hunter, healer, pilot, magical girl, street dancer, scholar
- Every run uses the exact roll: the harness writes a run folder holding the
  roll and forks it (`versions: 'current'`). A fork keeps the run's `dice`
  whole (`rollRunDice` only rolls a node with no roll), so an axis the agent
  gained since would go unrolled, and an axis it dropped would still print.
  The harness instead carries each roll forward: axes the agent still
  declares keep their values, new axes are rolled by the engine's code with
  the old values pinned, dropped axes are left out. `run_start`'s dice are
  checked against the intended roll on every run.
- Scripted counts: habits (a word or pair on half the cards that their own
  roll did not hand them), plus the tracked habits below. Every output is
  also read by hand.
- Harness and raw outputs: `scripts/derisk/out/gacha-designer/` (ignored).
  `npx tsx probe.mts run <agent> <rollSet> <name>` reruns a set.

## Baseline

Same rolls on both agents (the prompts are identical at this point, so the
two agents are two samples of one prompt).

| Habit | anime b1 | anime b2 | gacha b1 | gacha b2 |
|---|---|---|---|---|
| Pose opens on role/fashion filler — script | 6/8 | 5/8 | 7/8 | 7/8 |
| Pose opens on role/fashion filler — read | 8/8 | 7/8 | 8/8 | 8/8 |
| Pose says "styling"/"read as"/"unmistakable" | 4/8 | 4/8 | 5/8 | 5/8 |
| Core idea opens "She's" | 7/8 | 8/8 | 7/8 | 8/8 |
| Rolled role lost from the design (read) | 2/8 | 4/8 | 1/8 | 3/8 |
| Pose taken from another role (read) | 1/8 | 2/8 | 1/8 | 2/8 |
| Expression bent to fit the pose/hook (read) | 2/8 | 3/8 | 2/8 | 3/8 |
| Scripted word habits | none past "eyes" | none past "eyes" | none past "eyes" | none past "eyes" |

Read by hand:

- **Pose from another role.** Knight + "a mid-dance turn with one hand
  framing her face" (b1, both agents); healer + "holding a transformation
  brooch out" (b2); street dancer + "sitting sideways on a floating broom"
  (b2). A smoke run gave a knight bracing a maul while "making a finger-heart
  beside her cheek".
- **Role lost.** A borrowed pose or an occasion takes the role over: the
  healer with the brooch becomes "the sleepy neighborhood witch"; the street
  dancer on the broom becomes "the Joseon maid-café server"; the bounty hunter
  at a "rooftop DJ set" becomes "the sleepy rooftop DJ" (both agents, all three).
- **Pose filler.** Nearly every Pose opens on a reading, not a body: "Her
  quilted doublet and shield-shaped cassette bag make her read as a Nordic
  folk-armored knight;", "In her layered decora witch styling,", "A bounty
  hunter in glossy Y2K rooftop-DJ styling,". This is the required Pose
  opening ("her role and fashion or cultural styling, followed by…").
- **Leaks.** "make her read" 2/8 (gacha b1). No dice/rule/palette/"only" leaks.
- Out of scope, noted only: "Star Guard", "Date Guard" titles; long hair.

## Rounds

Two extra roll sets test whether a role collapses onto one pose once the
designer chooses: k8 (8 knights) and i8 (8 idols).

### Round 1 — pose qualities instead of a pose list (Jason picked approach A)

Change: the 25-value `pose` list (shared by every role, so knights drew
"making a finger-heart" and street dancers "a floating broom") becomes three
dice; the designer chooses the pose.

```yaml
pose energy: [fierce, calm, playful, cool]
pose mode: ["action: caught mid-move", "showcase: a held pose that shows off her look"]
pose level: ["low: sitting, kneeling, crouching or lying", "standing",
             "off the ground: jumping, floating or perched up high"]
```

Prompt: "Choose her pose yourself so it matches all three and is something
her role would do. Show the energy in her body and hands; never write the
rolled words."

1a was plain A, with showcase worded "presenting herself to the viewer" and
no wording guard. 1b reworded showcase and added the guard, rerun on 1a's
exact pose rolls. (A first 1b run carried from the original sets and so
rolled new pose dice; it was discarded and rerun.)

| gacha, 32 designs (b1 b2 k8 i8) | baseline | 1a | 1b |
|---|---|---|---|
| Pose from another role (read; b1+b2) | 3/16 | 0/16 | 0/16 |
| Hand/palm toward the viewer/audience/crowd | 0/32 | 7/32 (idols 4/8) | 0/32 |
| Pose says "presents"/"presenting" | 0/32 | 8/32 | 2/32 |
| A pose die's word pasted into Pose | — | 24/32 | 14/32 |
| Knights holding their weapon in Pose (read) | 8/8 | 8/8 | 8/8 |

The feared risk, every knight striking one stock pose, did not appear: all
knights already held their weapon when the pose was rolled, and the level die
spreads their bodies (leap, crouch-lunge, knee-slide, standing guard). The
risk showed up instead as idols turning a palm toward the viewer, read
straight off the showcase wording, which 1b removed. Performer gestures left
on knights (mic stand, wink, DJ controls) all trace to rolls that asked for
them (an idol-debut or DJ occasion, a wink expression).

Left over: the energy word still lands as an adjective (14/32), and against
a rolled expression it can contradict it ("her fierce movement at odds with
her sleepy expression", "a fierce, shy smile"). That is exploration 3's
question (one source for posture and face), so it is left for round 3.

**Kept** (1b). Ported to anime-designer; one batch on b2's rolls:

| anime b2 | baseline | round 1 |
|---|---|---|
| Pose from another role (read) | 2/8 | 0/8 |
| Hand/palm toward the viewer | 0/8 | 0/8 |
| Rolled role lost from the Core idea (read) | 4/8 | 4/8 |

The roles still lost are taken by the rolled occasion, not the pose (bounty
hunter at a "rooftop DJ set" → "the sleepy rooftop DJ"; street dancer at a
"maid café" → "the maid-café server"), as in the baseline.

### Round 2 — star rarity sets the detail budget (gacha-designer only)

Change: a `star` axis (★3 (R) common, ★4 (SR) uncommon, ★5 (SSR) rare;
57/28/15% over 7000 engine rolls) gates the detail axes with `by: star`, so
the code drops details instead of the prompt asking for restraint.

```
             ★3 (R)        ★4 (SR)              ★5 (SSR)
styling      1 item        1 + extra styling    1 + extra styling
asymmetry    symmetric     rolled               rolled
accent       none          rolled or none       rolled, never none
unreal       grounded      rolled (mostly on)   rolled, never grounded
showpiece    —             —                    where one large piece sits
```

`styling` (draws 1–2) became `styling` plus a gated `extra styling`; the
harness moves a carried second styling draw onto the new axis. The showpiece
rolls a place only ("trailing behind her", "rising above her head"…); the
designer chooses the piece.

Measured on round 1's rolls with the star pinned: b1 all ★3, b1 all ★5 (the
same 8 girls at both ends), and b2 dealt ★3 ★4 ★5 ★3 ★4 ★5 ★3 ★4.

| | round 1 (no star) | ★3 | ★4 | ★5 |
|---|---|---|---|---|
| Mean Clothes words, b1 | 78 | 72 | — | 83 |
| Mean Clothes words, b2 | 81 | 67 | 72 | 84 |
| Magic in the design not handed by a roll | — | 0/11 | — | — |
| Showpiece present where rolled (read) | — | — | — | 10/10 |
| "lavish"/"extravagant"/"no extra ornament" (2a → 2b) | — | 1 → 0 | — | 4 → 0 |

(Two ★3 cards match the magic word list only through a rolled feature:
"glowing irises", "glowing circuit lines".)

2a worded ★5 "a lavish showpiece" and the showpiece "one large, lavish
piece"; the designer pasted "lavish" into 4 of 10 ★5 designs, and a ★3 chef
ended "with no extra ornament". 2b drops the adjective and adds "Show it only
in what she wears; never write the star, its letters, or how plain or grand
she is", rerun on the same rolls: those leaks went to 0. No ★, R/SR/SSR or
rarity words leaked in either.

Read: ★3 cards are clean and symmetric (the knight keeps her cassette bag and
cord caster but loses the star-trailing ribbon); ★5 cards add a real piece
(a floating crystal witch hat, a comet-tail transformation ribbon, a silver
mesh butterfly circling like a wedding train). Two showpieces sit only in
Pose, which the illustrator also receives.

Left over: ★3's symmetric roll is voiced as "matching" (6/8 ★3 cards), and
the value "covering her outfit as ornament" came back as "…ornament" every
time it rolled (4/4), a vague word for an image model; renamed to "draped
across the front of her outfit" (checked in later rounds' ★5 cards).

**Kept** (2b). Not ported: star rarity is gacha-designer only.

### Round 3 — anime archetype as a concept die

Change: an `archetype` die (13 types, each with a short gloss so the model
reads it right; yandere rare) joins culture, role, motif and occasion as a
concept die fused into the core idea. The question was whether it feeds the
rolled `expression` (and round 1's `pose energy`) or replaces them; both were
run on the same archetype rolls (feed first, then the same rolls carried with
the two axes dropped). Sets: round 2's b1 ★3, b1 ★5 and b2 mixed, plus t8 —
b2's rolls with every archetype pinned to tsundere, to see whether one type
collapses onto one face.

- 3f feed: archetype added; expression and pose energy still rolled, "read
  through it".
- 3r replace: expression and pose energy removed; "It sets her expression
  and how she holds herself; choose both yourself so they show it."
- 3m: 3r plus a `moment` die — in character (common), "caught off guard:
  her type cracks for a moment" (uncommon), "at full blast: her type pushed
  to the extreme" (uncommon) — because 3r collapsed each type onto its stock
  face (the skill's "make the obvious value rare").
- 3g: 3m plus "never naming her type or writing the rolled words", because
  3m leaked the moment's wording.

| 32 designs unless noted | 3f feed | 3r replace | 3m +moment | 3g +guard |
|---|---|---|---|---|
| Face clashes with body or hook (read) | 11/32 | 0/32 | 0/32 | 0/16 |
| Archetype visible in face/posture, ★5 set (read) | 3/8 | 8/8 | 8/8 | — |
| t8: scowl/glare in Pose | 3/8 | 8/8 | 4/8 | 3/8 |
| t8: Core idea "insists… then…" | 5/8 | 6/8 | 4/8 | 3/8 |
| Kuudere "cool/blank/unreadable" (read) | 4/6 | 6/6 | 6/6 | 3/3 |
| Pose energy word pasted in | 17/32 | 0 | 0 | 0 |
| Moment words echoed | — | — | 2/8 (t8) | 0/16 |
| Archetype named / gloss echoed | 0 | 0 | 0 | 0 |

Read:
- Feed leaves the archetype faint — the rolled expression wins the face (a
  deredere witch "deadpan", a dojikko DJ "haughty") — and three independent
  face dice clash: "a fierce stance beneath her sleepy, haughty glare",
  "her fierce movement contrasts with her sleepy expression".
- Replace makes every face agree with the hook and the type, but each type
  gets its stock face: 8/8 tsundere scowl, 6/6 kuudere blank.
- The moment die breaks that a quarter to half the time while staying in
  type: a tsundere medic whose "scowl falters into a startled blush" when
  thanked; a dojikko whose "confident smile breaks into a wide-eyed,
  open-mouthed 'oops'"; a genki dancer who "laughs at full volume". "In
  character" cards keep the stock face, which is the point of the type.
- "bokukko: the tomboy who acts like one of the boys" was read literally
  (a DJ became "the groom's cocky best man"); reworded "the boyish tomboy,
  blunt and sporty" from 3r on (2 cards).

Decision: **replace**, with the moment die. **Kept** (3g). Ported to
anime-designer; b2's round-1 rolls with 3g's archetype and moment pinned:

| anime b2 | round 1 | round 3 |
|---|---|---|
| Face clashes with body or hook (read) | 4/8 | 0/8 |
| Pose energy word pasted in | 5/8 | 0/8 |
| Archetype visible (read) | — | 8/8 |
| Archetype named / moment words echoed | — | 0/8 |

Noted, not changed: five concept dice (culture, role, archetype, motif,
occasion) is one more than the skill's 3–4; the hooks still read as one idea.

### Round 4 — prune the role instructions into one paragraph

Change: three paragraphs that each restated "make the role visible" — one
of them "A role alone does not add another prop", which contradicts the
weapon rolls, and one asking to preserve the "rolled … expression" that no
longer exists — become:

> Her role is what she is: culture, archetype and occasion restyle it but
> never replace it. Show it through what the dice give her (garments,
> signature, styling, any weapon, her pose), not through extra props.

The Pose section's opening, "her role and fashion or cultural styling,
followed by her pose and expression", which produced "…make her read as a
Nordic folk-armored knight;" filler, becomes "One sentence that names her
role plainly (a knight, an idol), then her pose and expression…". The plain
label stays because the character-illustrator keeps "her role and culture
as plain labels (a knight, Tang-style), since they shape the picture" and
drops readings.

Sets: b2 mixed and t8 (before: 3g), plus k8 and i8 carried to the current
dice (before: the pre-prune prompt on the same rolls).

| 32 designs | before | after |
|---|---|---|
| Pose opens on role/fashion filler | 17/32 | 0/32 |
| Pose says "styling"/"read as"/"unmistakable" | 11/32 | 0/32 |
| Pose names her role | 20/32 | 32/32 |
| Core idea names her rolled role | 20/32 | 25/32 |
| Microphone no roll asked for | 4/32 | 6/32 |
| Pose opens "She is a knight," / "An idol, she" | 0/32 | 29/32 |

Read: the extra microphones are idols holding one (on-role) and a K-pop
knight's "microphone-shield"; the dropped prop rule did not unleash props
(4/8 idols already carried an unasked microphone under it). The role-label
opener is a new fixed sentence shape, but it is the label the format now
asks for, and the illustrator needs it; left as is. A knight at an "idol
debut stage" is labelled "a knight and an idol" — the occasion read as a
second role (1 card).

**Kept.** Ported to anime-designer; b2's round-3 rolls:

| anime b2 | round 3 | round 4 |
|---|---|---|
| Pose opens on role/fashion filler | 5/8 | 1/8 |
| Pose names her role | 4/8 | 8/8 |
| Core idea names her rolled role | 0/8 | 7/8 |
| Microphone no roll asked for | 0/8 | 0/8 |

The roles the baseline lost to the occasion come back: the healer at a
witches' tea party was "a streetwear witch", now "the tea-party medic"; the
street dancer at a maid café was "the maid-café server", now "the maid-café
street dancer". The bounty hunter at a "rooftop DJ set" is still "the
rooftop DJ" in the Core idea, though her Pose names her a bounty hunter.

## Left over

- "Core idea opens 'She's the…'" sits on 7/8 in nearly every batch since the
  baseline; no exploration targeted it.
- ★3 cards voice their symmetric roll as "matching" (about 5/8 ★3 cards).
- The Pose's role-label opener (29/32) is a fixed sentence shape by design.
- The bounty hunter + DJ-set occasion still merges into a DJ in the hook.
- One knight-at-k8 output was cut off mid-Pose in round 1a (max_tokens 4000
  with a reasoning model); none of the other 343 kept probe runs was cut.
