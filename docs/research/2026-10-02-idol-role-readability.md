# Idol role readability — 2026-10-02

The drawing's idol pin worked, but the illustrator omitted Core idea, often
the only section naming the role. The designer now supplies visual identity
in Pose; the illustrator copies Character, Clothes and Pose to NovelAI.

## Changes retained

- Require the role to appear through the rolled clothing and acting.
- Make Pose include role and fashion/cultural styling.
- Limit extra role-specific props to the existing signature/styling rolls.
- Tell the illustrator to copy Pose word for word; it extracts no identity.

All existing dice, weights, outputs and unrelated working-tree edits survive.
Agent definitions are loaded on each request; no plugin deployment is needed.

## Method

Production engine API at localhost:3000; gpt-6-luna and nai-diffusion-5-full.
The runtime generated 512×768 images. No model or image settings were changed.
Baseline: eight fresh designs with role pinned to idol and the drawing's five
cultures shortlisted. This particular roll set sampled three of those cultures.
Comparison rounds: two batches of eight, paired against the baseline rolls.
Forks with current agent versions preserve exact rolls, including multi-draw axes.
Image seeds remain random, so this is not a pixel-controlled comparison.

The initial harness narrowed multi-select lists instead of preserving them.
Six affected identity comparisons were discarded and replaced using forks.
The discarded records remain archived separately; retained comparisons match.

## Rounds

Baseline: literal idol identity reached the image scene in 0/8 calls.
Microphones appeared in 4/8 designs; 3/8 were not explicitly named by a roll.

Identity handoff: idol reached scene in 16/16 comparisons. Microphones appeared
in 3/8 and 4/8 designs. Retained. One Clothes call changed “from” to “at”; Pose
was copied exactly in every call. Prompt-only copying is not a byte guarantee.

Broad role rule: microphones appeared in 7/8 designs in both text batches,
with 6/8 per batch not explicitly specified by a roll. Rejected before rendering.

Role rule scoped to rolled signature/styling: microphones returned to 4/8 in
each batch, with 3/8 per batch not explicitly named by a roll. Some microphones
reinterpret generic signature rolls, such as a tool or a hair accessory.
Literal “idol” appears in 13/16 final scene fields; two others describe a
performer/headliner and one uses departure-stage/encore wording.

All 16 final calls made exactly one successful NovelAI call. Character and
Clothes matched their source sections exactly; scene began with the exact Pose.
Final recorded system prompts contain the revised instructions and actual rolls.
Every retained design and rendered image was read/inspected.

## Limits and checks

- Images with strong performance cues improved; several still read as fantasy
  fashion characters. Owner judgment of the idol feel remains outstanding.
- “Encore” remains an unrolled wording habit, 5/8 in both final batches. The
  skill's full habit-free stopping condition has not been established.
- No dice/rolled/palette/rules/sole leaks appeared in the final designs.
- Other-role text smoke runs preserved mechanic and knight identities. The
  knight also rolled “idol debut stage,” so its idol context was asked for.
- Four relevant designer contract tests pass. The full file already failed
  before this work: its expected axes/draws do not match the existing agent.
  That pre-existing test mismatch was left unchanged. `git diff --check` passes.

## Evidence

Raw prompts, rolls, calls, generated images and the reproduction harness:
`scripts/derisk/out/idol-role/` (ignored run artifacts).
Run `node scripts/derisk/out/idol-role/probe.mjs STAGE` to resume a saved stage.
Saved stages: baseline, identity, role (text only), role-scoped.
Contact sheets: baseline.png, identity-1/2.png, final-1/2.png.
Final preview: comparison.png, baseline 6/7 beside final 6/7 on matching rolls.
