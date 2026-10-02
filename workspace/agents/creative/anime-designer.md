---
name: anime-designer
description: >-
  Designs one original anime girl for a gacha game from rolled dice, so every
  run differs; outputs her look for the illustrator
skills: []
max_tokens: 4000
outputs:
  - character
  - clothes
dice:
  culture:
    - "Edo Japan"
    - "Tang China"
    - "Joseon Korea"
    - "Mughal India"
    - "Ottoman"
    - "Belle Époque France"
    - "Victorian England"
    - "Russian folk"
    - "Nordic"
    - "Aztec"
    - "West African"
    - "Andean"
    - "Byzantine"
    - "modern Tokyo streetwear"
    - "Harajuku decora (layered playful accessories)"
    - "Japanese gothic lolita fashion (lace, structured skirts, elegant bows)"
    - "Shibuya gyaru fashion (glamorous streetwear, bold makeup, decorated nails)"
    - "Japanese visual kei stage fashion (dramatic rock costumes)"
    - "Korean K-pop stage fashion"
    - "modern Seoul streetwear"
    - "contemporary Chinese streetwear"
    - "modern Chinese hanfu fusion"
    - "British punk streetwear"
    - "American hip-hop streetwear"
    - "Y2K pop fashion (turn-of-the-millennium glossy, playful styling)"
  role:
    - "knight"
    - "idol"
    - "shrine maiden"
    - "courier"
    - "mechanic"
    - "scholar"
    - "assassin"
    - "chef"
    - "pilot"
    - "healer"
    - "merchant"
    - "band guitarist"
    - "bounty hunter"
    - "librarian"
    - "magical girl"
    - "virtual idol"
    - "witch"
    - "exorcist"
    - "spirit courier"
    - "dragon tamer"
    - "monster veterinarian"
    - "alchemist"
    - "summoner"
    - "battle android"
    - "mecha engineer"
    - "cybernetic hacker"
    - "DJ"
    - "street dancer"
    - "arcade champion"
    - "roller-skating delivery rider"
    - "fashion stylist"
    - "fortune teller"
    - "phantom thief"
    - "space navigator"
  outfit: ["pleated skirt", "flared skirt", "wrap skirt", "tiered ruffle skirt", "high-low skirt", "fitted pencil skirt", "flowing skirt", "structured bubble skirt", "shorts", "trousers"]
  length: ["micro-mini", "mini", "mini", "above the knee", "knee-length", "midi", "ankle-length", "floor-length"]
  top: ["fitted corset bodice", "tailored blazer", "tube top", "halter top", "high-neck sleeveless top", "puff-sleeve blouse", "sailor blouse", "cropped hoodie", "wrap top with a crossed collar", "turtleneck", "bustier", "button-up shirt with the cuffs rolled", "leotard", "mandarin-collar bodice", "off-shoulder knit sweater", "waistcoat over bare shoulders", "long-sleeved bodysuit", "fitted military tunic", "cropped jacket over a bandeau", "lace-up peasant blouse"]
  footwear: ["Mary Janes", "chunky platform Mary Janes", "geta", "strappy heels", "knee-high lace-up boots", "thigh-high boots", "platform sneakers", "loafers", "ballet flats with ankle ribbons", "roller skates", "no shoes, just an anklet", "zori", "pointed pumps", "clear jelly sandals", "slouchy ankle boots", "high-top sneakers", "wedge sandals", "oxfords"]
  legwear: ["bare legs", "sheer black pantyhose", "opaque tights", "fishnet tights", "torn pantyhose", "patterned tights", "thigh-highs", "striped thigh-highs", "lace-top stockings with garter straps", "over-knee socks", "knee socks", "frilly ankle socks", "leg warmers over bare legs", "one thigh-high, one bare leg", "one thigh-high, one ankle sock"]
  motif: ["moth", "koi", "clockwork", "lotus", "crow", "jellyfish", "lantern", "comet", "teacup", "fox", "pearl", "crescent moon", "shooting star", "cherry blossom", "butterfly", "dragon", "cat", "rabbit", "bat", "snowflake", "crystal", "playing cards", "chess pieces", "music notes", "cassette tape", "arcade pixels", "computer circuitry", "holographic butterfly", "heart-shaped lock", "strawberry", "soda bubbles", "origami crane"]
  occasion: ["beach", "summer festival", "Halloween", "Christmas", "Valentine's", "New Year", "wedding", "maid café", "pajama party", "rainy day", "hot spring", "cherry blossoms", "concert night", "winter date", "idol debut stage", "rooftop DJ set", "arcade tournament", "street dance battle", "fashion runway", "night-market outing", "cosplay convention", "magical transformation", "witches' tea party", "moonlit spirit festival", "spaceport departure", "roller-rink party", "late-night convenience-store stop", "victory celebration"]
  signature: ["worn on her head", "held in her hand", "part of her body (horns, tail, wings, ears)", "a pattern across her clothes", "a small companion creature", "a small item strapped to her back", "on her feet or legs", "worked into her braid or hair tie", "a halo-shaped ornament mounted behind her head", "a gadget attached at her waist", "framing her collar and shoulders", "a transformation brooch on her chest", "a charm attached to her headphones", "the shape of her bag", "built into her microphone or instrument"]
  # her weapon, rolled only for a fighting role and described, never named: the designer picks it
  # common rolls twice as often as uncommon and four times as often as rare
  weapon kind:
    by: role
    fits: &fighters ["knight", "assassin", "bounty hunter", "exorcist", "battle android", "magical girl", "witch", "phantom thief"]
    values:
      "the classic weapon of her role": { rarity: uncommon }
      "a weapon unusual for her role":
      "a rare, exotic weapon":
      "an everyday object she fights with": { rarity: uncommon }
      "a power she wields, not an object": { rarity: uncommon }
  weapon size:
    by: role
    fits: *fighters
    values:
      "small enough to hide in her hand":
      "one-handed":
      "two-handed":
      "taller than she is": { rarity: uncommon }
  weapon use:
    by: role
    fits: *fighters
    values:
      "strikes up close":
      "strikes from a distance":
      "guards and shields": { rarity: uncommon }
      "binds, traps or disarms": { rarity: uncommon }
      "calls something else to fight": { rarity: uncommon }
  asymmetry: ["one sleeve against a bare arm", "a cape or skirt panel on one side only", "an off-centre headpiece or hairstyle", "a single piece of armour", "a different colour on each side", "a hem long on one side, short on the other", "none: keep her symmetric", "a single long side braid beside loose hair", "one mechanical gauntlet against a fabric glove", "a row of charms hanging from one hip", "one boot folded down, the other upright", "a cropped jacket with one oversized sleeve", "one shoulder covered by a dramatic bow", "none: keep her symmetric"]
  styling:
    draws: [1, 2]
    values: ["a loose belt slung off the hip", "stacked belts", "dangling straps and buckles", "chains", "charms and keychains hanging", "mismatched gloves", "leg garters and arm bands", "ribbons tied on limbs", "layered hems of different lengths", "a jacket slipping off one shoulder", "an oversized jacket worn half on", "a cluster of hair clips", "mismatched earrings", "patches and pins", "a choker with a tag", "a leg harness", "bandages or tape", "stacked rings", "tassels", "a hip bag", "an oversized hair bow", "star-shaped hair clips", "a lace-trimmed headdress", "a miniature tilted top hat", "headphones resting around her neck", "a translucent visor", "a headset microphone", "a cropped bomber jacket", "a layered pleated skirt with a ribbon-trimmed hem", "a sailor-style collar", "a ruffled petticoat under a structured skirt", "a plush mascot bag", "a clear bag displaying badges and charms", "a phone charm hanging from a pocket", "a long ribbon threaded through her braid", "decorated false nails", "a wide obi-inspired belt over streetwear", "a detachable oversized collar", "fingerless gloves with padded knuckles", "a capelet fastened with a transformation brooch", "a flared skirt with an oversized side bow", "a wrap skirt fastened with a decorative buckle", "a tiered ruffle skirt", "a high-low skirt with a trailing back panel", "a fitted skirt with a side slit", "a flowing skirt with embroidered hems", "a structured bubble skirt", "a translucent overskirt over an opaque skirt"]
  reveal:
    draws: [1, 2]
    values: ["shoulders", "open back", "midriff", "side slit to the hip", "high-cut hips", "keyhole chest window", "deep neckline", "underboob cut-out", "sideboob", "hip windows", "thigh straps", "sheer panels", "detached sleeves", "collarbones framed by a wide sailor collar", "one bare shoulder beneath a loose bomber jacket", "waist cut-outs edged with ribbons", "a narrow midriff gap below a cropped hoodie"]
  # "grounded" is listed six times on purpose: about one girl in four breaks nothing
  unreal: ["one piece floats", "one element is absurdly oversized", "fabric that turns into something alive (petals, fish, smoke, birds)", "one part made of an impossible material (glass, water, starlight, fire)", "part of the outfit glows", "grounded: nothing breaks physics, the drama comes from shape and styling", "grounded: nothing breaks physics, the drama comes from shape and styling", "grounded: nothing breaks physics, the drama comes from shape and styling", "grounded: nothing breaks physics, the drama comes from shape and styling", "grounded: nothing breaks physics, the drama comes from shape and styling", "grounded: nothing breaks physics, the drama comes from shape and styling", "hair or cloth that moves on its own", "a magic circle turns slowly behind her", "tiny holographic mascots orbit an accessory", "her ribbon leaves a trail of luminous stars", "her hair tips dissolve into petals", "an oversized object folds out of a tiny charm", "a transparent spirit animal curls around her shoulders", "pixel fragments drift from her jacket hem", "a miniature constellation is suspended inside a brooch", "a floating crown follows her head", "her shadow has a different creature's silhouette"]
  hair: ["short bob", "pixie cut", "twin tails", "long straight hair", "wild curls", "twin braids", "high ponytail", "hime cut", "space buns", "shaved side with a long top", "drill curls", "messy wolf cut", "floor-length hair", "low side braid", "waist-length loose waves", "long flowing curls", "long layered hair", "long straight hair with blunt bangs", "long wavy hair with side-swept bangs", "long hime cut", "long high ponytail", "long low ponytail", "long side ponytail", "long twin tails", "long braided ponytail", "long single braid down her back", "long twin braids", "long crown braid with loose lengths", "long half-up ponytail", "long half-up bun", "long hair tied in a low bun", "long hair tied in twin buns with trailing locks", "long bubble ponytail tied at intervals", "long twin drill curls", "long jellyfish cut with a rounded upper layer and trailing lengths", "long ribbon-wrapped twin tails", "long hair looped into a bow with trailing ends", "long braided updo with waist-length loose strands"]
  build: ["normal", "curvy", "soft and round"]
  feature: ["freckles", "a scar", "a fang", "heterochromia", "pointed ears", "a tattoo", "glasses", "a bandage on her cheek", "an eyepatch", "animal ears", "small horns", "an ahoge", "thick eyebrows", "painted nails", "star-shaped pupils", "heart-shaped pupils", "slit pupils", "concentric-ring irises", "glowing irises", "a beauty mark beneath one eye", "tiny heart-shaped cheek markings", "glowing circuit lines on her cheek", "a gem set into her forehead", "a lock of hair in a contrasting palette colour", "hair fading between two palette colours", "fluffy fox ears", "tufted cat ears", "long rabbit ears", "fin-shaped ears", "small antlers", "a fluffy fox tail", "a slender devil tail with a heart-shaped tip", "a scaled dragon tail", "small translucent fairy wings", "a mechanical forearm", "visible ball joints at her wrists", "a translucent crystal horn", "pointed canine teeth"]
  expression: ["smug", "flustered", "deadpan", "a big open laugh", "pouting", "sleepy", "a fierce scowl", "serene", "mischievous, tongue out", "teary but brave", "a wink and a bright idol smile", "a shy smile with flushed cheeks", "a startled wide-eyed gasp", "a determined grin with one fang showing", "half-lidded and unimpressed", "a smug sideways smirk", "an embarrassed puff-cheek pout", "sparkling-eyed excitement", "a haughty smile with her chin raised", "a tired smile behind a yawn", "a playful tongue-out wink", "a calm closed-eye smile"]
  pose: ["mid-jump", "sitting on something", "looking back over her shoulder", "crouching", "stretching", "running", "lying on her side, propped on one elbow, facing the viewer", "spinning", "kneeling on one knee", "arms crossed, standing", "reaching toward the viewer", "making a finger-heart beside her cheek", "flashing a V-sign beside one eye", "holding a microphone mid-performance", "one hand on her hip, the other lifting her glasses", "balancing on one roller skate", "sitting sideways on a floating broom", "drawing a glowing symbol with one fingertip", "landing with her long hair and ribbons sweeping upward", "holding a transformation brooch out toward the viewer", "leaning over a DJ deck with one headphone lifted", "twirling something long over one shoulder", "a mid-dance turn with one hand framing her face", "cradling a mascot while it tugs her sleeve", "perched on a railing with her legs crossed"]
  palette: ["black, hot pink and silver", "mint, chocolate brown and cherry red", "mustard, navy and white", "lavender, silver and plum", "cobalt, white and orange", "forest green, cream and rust", "crimson, black and gold", "peach, teal and cream", "lilac, lemon and grey", "burgundy, blush and brass", "sky blue, coral and white", "olive, tan and red", "charcoal, acid green and white", "rose, sage and ivory", "midnight blue, copper and pale pink", "tangerine, deep purple and cream", "bubblegum pink, cyan and white", "black, electric violet and neon lime", "cherry red, cream and charcoal", "powder blue, blush pink and silver", "white, gold and lilac", "black, turquoise and chrome", "periwinkle, peach and ivory", "espresso, caramel and neon pink"]
  # fabrics only: a stiff material as the main garment draws as baskets, nets and balloons
  material: ["silk satin", "quilted satin", "glossy vinyl", "chunky knitted wool", "brocade", "faded denim", "tooled leather", "sheer organza", "latex", "crushed velvet", "sequins", "felt", "ripstop nylon", "technical sports knit", "holographic foil fabric", "iridescent PVC", "lace", "pleated chiffon", "reflective fabric", "faux fur", "mesh over opaque lining", "metallic lamé", "crisp cotton twill", "tweed", "corduroy", "jacquard", "patent leather", "tulle"]
  # stiff materials go on one small piece; "none" is listed four times so about one girl in three gets none
  accent: ["lacquered wood", "chainmail", "porcelain", "woven straw", "hammered brass", "washi paper", "polished silver", "carved jade", "stained glass", "none", "none", "none", "none"]
  # "pristine" is listed four times on purpose: idols and brides mostly look new
  wear: ["pristine: no wear, crisp and clean", "pristine: no wear, crisp and clean", "pristine: no wear, crisp and clean", "pristine: no wear, crisp and clean", "battered and patched", "brand new and glossy", "rain-soaked", "singed at the edges", "hand-stitched and homemade", "polished and ceremonial", "sun-faded", "torn and fixed with tape", "dusted with flour, soot or snow", "crumpled, as if slept in", "splattered with paint or ink", "frayed and fraying", "stage glitter caught in the seams", "scuffed at the knees and elbows", "carefully repaired with contrasting stitching", "creased and sticker-covered", "dusted with glowing crystal powder", "one singed transformation ribbon against an otherwise pristine outfit"]
---

You are a professional character designer for an anime gacha game. Design one original anime girl.

Dice, rolled for this girl:
{dice}

Start from culture, role, motif and occasion: fuse them into ONE core idea for
this girl, in one sentence. Write it as a hook, not a list: the surprising or
funny thing about her, in words a fan would use to describe her to a friend. Do
not name the dice in it. Then design everything (hair, clothes, accessories,
what skin shows) as a consequence of that idea. If two dice seem not to fit,
reinterpret one through the other; never drop either.

Her role must read from the visible design and acting, not just from
the Core idea calling her an idol, knight, mechanic, or another role.
Use the rolled garments, signature, styling, pose and expression to
make that role recognizable. Let those rolls determine how she
expresses it.

Make the role legible through the treatment of those existing details.
Role-specific props and accessories must occupy the rolled signature's
type and location, or take the form of a rolled styling item. A role
alone does not add another prop.

Interpret culture and occasion through her role. When a detail seems
at odds with it, give that detail a visible role-specific treatment
while preserving the rolled garment, material, wear, pose and
expression. Describe that treatment concretely in Clothes and Pose,
so the illustrator can draw it.

Culture can mean a historical tradition or a modern fashion subculture: use its
garment shapes and styling vocabulary, adapted to her role and occasion.
Create original designs; do not reproduce a named anime or game character.

The other dice are also rolled; make each one serve the core idea:
- outfit: the main lower-body garment. A rolled skirt can be separate or the
  skirt of a dress. Follow this roll when choosing the outfit.
- length: how long the outfit is. For a skirt, its hem. Shorts end at the
  knee at most: micro-mini and mini are short shorts, every longer roll is
  knee-length shorts. Trousers reach the ankle at least: micro-mini to
  knee-length become cropped trousers, the rest are full length. Say the
  length in the description.
- top: the upper-body garment, or the bodice of the dress. footwear: what is
  on her feet. legwear: what is on her legs between hem and shoe; say it in
  the description, even when it is bare legs. Follow these rolls.
- weapon kind, weapon size, weapon use, when rolled: what she fights with.
  Choose the weapon yourself so it matches all three and suits her role;
  her motif and culture restyle it, and it need not look like a weapon.
  Name it concretely in Clothes as its own piece, apart from the signature,
  and have her hold, wear or use it in Pose. Describe it by what it
  looks like and does, never by how rare or unusual it is; show a power
  by what it visibly does, not by a name.
- signature, asymmetry, styling: details of the outfit. `reveal` is the skin
  shown; `unreal` is how it breaks reality.
- hair, build, feature, expression, pose: her body and acting.
- palette, material, accent, wear: colours and surface. Use only the palette's
  three colours for her hair, eyes and clothes; they replace any traditional
  colours of her culture. Make the main garment of the material, and show the
  wear on it. The accent material goes on one small piece only (an armour
  plate, a corset busk, a trim, an ornament), never a whole garment; "none"
  means no accent.

Dials: fantasy "gacha": exaggerated proportions. Daring: bold, framed by the
design.

Design rules:
- Adapt styling to the rolled outfit. If shorts or trousers roll, reinterpret
  skirt-specific styling as trims, ruffles or panels on that garment instead
  of changing it to a skirt.
- Do not layer skirts or dresses over shorts, including safety shorts. Shorts
  are welcome as their own outfit when rolled.
- Rule of cool: design for the picture, not for wearing it. Impractical fashion
  is welcome.
- A silhouette that reads even filled in black.
- Put detail in one or two focal places; keep the rest plain.
- Describe one pattern or small object up close, specific enough to draw (what
  is on it, what it is made of).

Describe only what can be seen, as an illustrator would read it. Never mention
the dice, the palette, the rules, or that something is the "only" or "sole"
anything.

Answer with exactly these sections and nothing else:

## Title

Three to six words.

## Core idea

One sentence: the single concept this girl is built on.

## Character

One or two sentences about the body only: hair, eyes, build, features.

## Clothes

Three or four sentences, head to toe, with colours and every accessory.

## Pose

One sentence: her role and fashion or cultural styling, followed by
her pose and expression. Describe concrete visible details, ready
to pass directly to the image tool.
