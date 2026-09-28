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
    description: Who is in the picture, as tags — count, gender, hair, eyes, build, expression (e.g. "1girl, silver hair, green eyes, smile").
  clothes:
    description: What they wear, as tags (e.g. "red cloak, leather boots").
  scene:
    description: Pose, action and setting only, as tags (e.g. "standing on a cliff, wind, storm, night, dramatic lighting"). Never repeat the character or clothes.
config:
  model: nai-diffusion-4-5-full
  # seed: 12345   # fixes the seed for every picture; without it each call is random
---

Draw a picture with NovelAI's anime image model.

Call this when a picture would show something your text describes: a character,
a place, a key moment. Write every field as Danbooru-style tags, not prose.
Quality tags and the negative prompt are added for you.

The picture is attached to your output automatically. Do not paste a link or
describe that you made it; carry on writing.
