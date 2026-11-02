# Role recognition: the role marker — 2026-10-02

Witches and alchemists did not read as their role. The designer's prompt
blocked the piece each role is recognised by: first "Role-specific props must
occupy the rolled signature's type and location… A role alone does not add
another prop", then (after the gacha-designer port) "Show it through what the
dice give her (…), not through extra props." The fix is a new `role marker`
axis that rolls *how* her role's best-known piece is treated; the designer
chooses *which* piece. The marker is never her weapon, and it sits apart from
the signature, so the signature goes back to just looking good.

Result: the iconic piece went from 9/32 designs to 32/32 on the same rolls.

## The change (port this)

Axis, placed right after `role` in the dice block:

```yaml
  # how the piece her role is known by shows; the designer picks the piece, never her weapon
  role marker:
    values:
      "the piece her role is known by, in its classic form":
      "the piece her role is known by, restyled by her culture":
      "the piece her role is known by, built into her clothes": { rarity: uncommon }
      "two small pieces her role is known by": { rarity: uncommon }
```

Prompt: only the "not through extra props" sentence was replaced. The
paragraph now reads:

```
Her role is what she is: culture, archetype and occasion restyle it but
never replace it. Show it first with the piece a fan knows her role by at a
glance, treated as `role marker` says. Choose the piece yourself; it is never
her weapon, and it is its own piece, apart from the signature. Describe it in
Clothes by what it looks like, never with the rolled words, and in Pose name
it right after her role.
```

`character-illustrator.md`, the `scene` bullet:

```
- `scene`: the design's Pose section, only what can be seen, then add: solo,
  one girl alone, full body from head to feet in frame, a simple background.
  Start it with her role and the piece the Pose names with it (witch, tall
  pointed hat), even though Clothes shows that piece too. Otherwise do not
  repeat the body or clothes here.
```

The "Otherwise" matters: without the exception, "do not repeat the clothes"
would strip the piece from the scene.

## Method

- Engine at localhost:3000, `anime-designer` on gpt-6-luna; text only.
- Baseline: 8 fresh designs each for witch, alchemist, idol and mechanic, role
  pinned, on the prompt with the gacha-designer port (archetype, moment, pose
  mode/level, the shorter prop rule). All 32 prompts checked to carry it.
- After: the same 32 rolls, each axis pinned to its baseline value (multi-draw
  axes pinned as one joined string, so the prompt line is identical; checked
  32/32), with `role marker` rolled fresh. One empty reply (witch #0) re-run
  on the same roll.
- A fork does not work for this: it copies the old roll whole, so a newly
  added axis goes unrolled (checked on `2026-10-02-DZas5m`).
- Marker rolls drawn: classic 13, restyled 10, two small pieces 6, built into
  clothes 3.
- Counted by reading: is the role's best-known piece present, a separate
  piece, and big enough to draw? A weapon does not count.

## Numbers

| role | before | after | the piece, after |
|---|---|---|---|
| witch | 0/8 | 8/8 | pointed hat 7 (classic, conical, Aztec stepped cone, straw-brim), two tiny hat clips 1; broom 0, cauldron 0 |
| alchemist | 1/8 (+1 coil inside a mic) | 8/8 | glass retort or alembic 7, two flask pins 1 |
| idol | 3/8 | 8/8 | microphone 8: handheld 6, badge 1, headset 1 |
| mechanic | 5/8 | 8/8 | wrench or spanner 7 (2 as pins), socket belt / tool belt 2 |

Before, witches got a parasol, a fan, a yo-yo, a top hat; one had a tiny spell
folio. Alchemists got a microphone, steam from a palm, a headphone charm.

### Idol microphone

On all 8, but never the same plain mic: each grille is restyled to her motif
or culture (lantern cage, snowflake badge, onion dome, cassette spool, fox
tail, jellyfish bell); one is a plain brass handheld. By the rule "the same
plain mic on most counts as a habit" this passes. The themed grille itself is
a pattern (6/8).

### What to watch

Each role now lands on its single best-known object: pointed hat 7/8, retort
7/8, wrench 7/8. Treatment varies with the marker roll, the object does not.
A next round could roll where the piece sits (on her head, in her hand, on
her body, carried at her side), so a witch's piece is sometimes a broom.

## Leaks

The designer named the marker or said what it shows in 6/32 after-designs
(0/32 before): "Her alchemist's marker is…", "Her idol marker is…", "marks her
as a witch at a glance", "marks her as a witch", "marked by twin brass spanner
pins", "her leg signature… instantly recognizable shape". The illustrator
strips all of them (see below), so they never reach the image model. They
still read badly on screen; untested fix: "Describe it only by what it looks
like; never call it a marker or say what it shows about her."

## Illustrator check

A temporary text-only copy of `character-illustrator` (no tools; wrote the
`novelai` arguments as JSON instead; deleted afterwards) ran on 11 of the
after-designs (witch 0, 1, 4, 7; alchemist 8, 13; idol 17, 19, 22; mechanic
26, 29). Every `scene` starts with role then marker, e.g. "witch, tilted olive
pointed hat, leaping with one knee tucked…", "Mechanic, twin brass spanner
pins at her collar; balances upright…". Every leak above was removed. Nothing
visible was dropped; "trailing like tentacles" became "trailing below", per the
existing rule against comparisons.

## Verdict

Keep. Every role reads, the signature is free again, and the idol has no
plain-mic habit. Open: the single-object habit per role, and the marker leak
in the designer's own text.

## Runs

Baseline → after (same rolls), in `workspace/logs/`:

- witch: -QIyfO→DvIYaR, 3F0ewU→qhy492, AedZyd→UlXlcB, jdXmSy→EIB7Oz,
  jEyHBU→9CWawD, 4OISmY→Njr3B7, gXUWC3→Wnh6o4, E_Rn9W→4GprFu
- alchemist: -j5U6b→WfYUz9, R7YIFE→VA-K3X, ncJ9N6→vuYlH9, tDwoSW→_70zsk,
  iIi6lb→N5OC4f, FDG4UI→oJ4-nC, pK3nht→vepOLZ, 9kXBHb→nSf4m9
- idol: YGWFwR→8_L5wz, 6YgpEE→2pOqoa, i2rEXU→dcm3cH, yq0oEP→swge5S,
  VLhhEo→PluMd8, Gsy1xX→-h2mWp, lGGI_9→T2tFM9, wkr0rQ→0vgzUQ
- mechanic: uPLjVc→G0Rg3p, _hG-Dd→mz4QvF, FCKWe9→23AhGt, L0VjwW→sAqU_y,
  ewrgyH→TnQXof, XRUp5f→9BO6Pg, MzTaiD→L0Krsy, DFMXqS→IzT7lr

All ids are prefixed `2026-10-02-`.
