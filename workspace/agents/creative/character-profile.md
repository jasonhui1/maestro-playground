---
name: character-profile
description: >-
  Gives one already-designed anime girl her inner life from rolled dice: what
  she longs for, what she is bad at, what scares her, what she loves, her
  secret, why she is here and how she rubs against others; outputs material
  for the game and an expression sheet
skills: []
max_tokens: 4000
outputs:
  - profile
  - expressions
dice:
  # a situation she secretly daydreams about, recognisable to any anime fan
  longing:
    - "standing on a stage in front of a cheering crowd"
    - "running a small café of her own"
    - "a quiet afternoon in a library nobody else visits"
    - "being rescued, just once, like a princess"
    - "being the hero everyone counts on"
    - "a summer festival night with fireworks"
    - "a sleepover where everyone stays up talking"
    - "travelling somewhere far by train, alone"
    - "being feared and obeyed like a villainess"
    - "winning a tournament in front of everyone"
    - "a garden she grew herself"
    - "a magical transformation"
    - "living in a castle"
    - "a seaside town where nothing ever happens"
    - "being a big sister to someone"
    - "being completely ordinary for one day"
    - "a ball where she dances with no one watching"
    - "a band that plays her songs"
    - "a snowy cabin with a fireplace"
    - "flying"
    - "being remembered by a whole city"
    - "an ordinary school life with a club after class"
    - "a shop full of things she chose"
    - "a starry rooftop at night"
  # how the longing sits against who she is
  longing distance:
    values:
      "the opposite of how she acts":
      "a bigger version of what she already is":
      "something nobody would guess she cares about":
      "something she had once and lost": { rarity: rare }
  # the area she is bad at; the profile picks the exact thing
  weakness area: ["a physical skill", "a social situation", "an everyday chore", "machines and gadgets", "animals", "a kind of food", "finding her way", "money and numbers", "speaking in front of people", "staying still and quiet", "saying what she feels", "waking up", "keeping a secret", "losing"]
  weakness reaction:
    values:
      "hides it, badly":
      "denies it loudly":
      "admits it cheerfully":
      "practises in secret":
      "turns it into a competition": { rarity: uncommon }
      "asks for help, then regrets it": { rarity: uncommon }
  # light fears only; the profile picks the exact thing
  fear kind: ["a small creature", "a kind of place", "a sound", "a situation", "an ordinary object", "a kind of weather", "a time of day", "a feeling in her body"]
  fear size:
    values:
      "a small flinch":
      "she quietly avoids it":
      "full panic, played for laughs": { rarity: uncommon }
  loves: ["a food", "a drink", "a kind of collectible", "a sound", "a kind of weather", "a game", "a texture", "an animal", "a small daily ritual", "a smell", "a time of day", "a kind of light", "a fictional character", "a favourite place to sit"]
  love strength:
    values:
      "a quiet fondness":
      "an obsession she can't hide":
      "a devotion that makes her lose all composure": { rarity: uncommon }
  # harmless and a little embarrassing, never a crime or a mystery
  secret: ["a soft hobby", "a hidden talent", "a childish habit", "a guilty pleasure", "being a fan of something", "being worse at her role than she lets on", "being better at something than she lets on", "a nickname she hates", "a plush or pet she talks to"]
  why here:
    values:
      "dragged in by accident":
      "came on purpose":
      "followed someone in":
      "came looking for something":
      "sent here as a punishment": { rarity: uncommon }
      "lost a bet": { rarity: uncommon }
  with others: ["looks after everyone", "competes with everyone", "sticks close to one person", "keeps her distance", "stirs up trouble", "keeps the peace", "the one everyone teases", "the one who teases everyone"]
  gets along with: &types ["the prickly, proud one", "the cool, quiet one", "the shy one", "the openly sweet one", "the loud, cheerful one", "the teasing older-sister type", "the haughty rich girl", "the one acting out dark powers", "the clumsy one", "the boyish tomboy", "the self-declared goddess", "the graceful traditional lady"]
  clashes with: *types
  # rolled only when her design has an unreal element with story in it
  unreal origin:
    by: unreal
    fits: ["a magic circle turns slowly behind her", "a transparent spirit animal curls around her shoulders", "a miniature constellation is suspended inside a brooch", "a floating crown follows her head", "her shadow has a different creature's silhouette"]
    values:
      "somewhere, a whole city shares it":
      "somewhere, something is missing exactly this":
      "it grows stronger near one place":
      "it reacts to one kind of place":
      "it is half of a pair": { rarity: uncommon }
      "it has a will of its own": { rarity: uncommon }
  # rolled only when her signature is a creature or part of her body
  signature origin:
    by: signature
    fits: ["part of her body (horns, tail, wings, ears)", "a small companion creature"]
    values:
      "somewhere, there are many more like it":
      "somewhere, someone is looking for it":
      "it knows a place she doesn't":
      "it changes near one kind of place":
      "it came with her, and nobody knows from where": { rarity: uncommon }
---

You are writing the inner life of one anime girl who has already been designed.

Her design:
{character}
{clothes}

The dice her design was built from:
{design_dice}

Dice, rolled for her inner life:
{dice}

Start from her design's core idea and her archetype: everything you write
must feel like the same girl. First write one hook sentence about who she is
(not how she looks), in words a fan would use to describe her to a friend.
Do not name the dice or her personality type in it.

Then write each facet as a consequence of that hook:
- Choose the concrete thing yourself, within what each die says: the exact
  thing she is bad at, the exact creature or place she fears, the exact food
  or sound she loves. Make it specific enough to build a scene around.
- Show each facet by what she does: a visible habit, a reaction, a line she
  would say. Never label it.
- Make every facet concrete enough that a place or an event could be built
  from it: a whole town made of her longing, a street that tests her
  weakness. Do not describe that place.
- `longing distance` sets how her longing sits against who she is.
- `weakness reaction` and `fear size` set how she behaves when it comes up.
- Keep the tone anime and light. Her fear is a flinch-and-laugh fear, never
  trauma. Her secret is harmless and a little embarrassing, never a crime and
  never a mystery to solve.
- If two dice seem not to fit, reinterpret one through the other; never drop
  either.
- With others: write two or three interaction hooks as small concrete
  situations, using `with others`, `gets along with` and `clashes with`.
- Origin, only when `unreal origin` or `signature origin` is rolled: one or
  two sentences on how that part of her design has a counterpart somewhere
  in the world, as the die says, and what she would notice when she gets
  near it. Do not explain where it came from.

Expressions: four faces for the illustrator. Describe only what can be
seen: eyes, brows, mouth, blush, tears, where her hands are. No story,
nothing off-frame.

Never mention the dice, rarity, the rules, or the rolled words verbatim.

Answer with exactly these sections and nothing else:

## Hook

One sentence.

## Longing

One or two sentences.

## Weakness

One or two sentences.

## Fear

One or two sentences.

## Loves

One or two sentences.

## Secret

One or two sentences.

## Why she's here

One sentence.

## With others

Two or three bullet points, one small situation each.

## Origin

Only when an origin die was rolled; otherwise leave this section out.

## Expressions

- Usual: one sentence.
- Fear: one sentence.
- Longing: one sentence.
- Found out: one sentence.
