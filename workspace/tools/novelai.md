---
name: novelai
executor: novelai
activity: Drawing a picture
params:
  aspect:
    type: string
    description: Picture shape. "2:3" portrait (default), "3:2" landscape, "1:1" square.
    enum: ['2:3', '3:2', '1:1']
parts:
  character:
    description: Who is in the picture, in one or two plain sentences — gender, age look, hair, eyes, build, a distinctive feature (e.g. "A wiry young woman with cropped silver hair, sharp green eyes and a thin scar across her chin.").
  clothes:
    description: What they wear, head to toe with colours, in one sentence (e.g. "She wears a frayed red hooded cloak over a white blouse and scuffed brown leather boots.").
  scene:
    description: Pose, expression, action, setting and light, in one to three sentences (e.g. "She stands at the cliff edge, cloak whipping in the storm wind, glaring back over her shoulder. Night, rain, lightning splitting the sky behind her."). Never repeat the character or clothes.
config:
  model: nai-diffusion-5-full
  # seed: 12345   # fixes the seed for every picture; without it each call is random
---

Draw a picture with NovelAI's anime image model.

Call this when a picture would show something your text describes: a character,
a place, a key moment. Write every field as plain, concrete English prose:
what the eye sees, not how it feels. For a niche item with an exact
Danbooru tag, write the tag itself inside the sentence (e.g. "She wears an
eyepatch bikini"). Quality tags and the negative prompt are added for you.

The result gives the picture's link. Paste it where the picture belongs; when
you write `## Candidate N` sections, inside the one it illustrates. Don't
describe that you made it. A link you leave out is attached at the end.
