---
name: retrieve
executor: retrieve
activity: Searching the lore
params:
  query:
    type: string
    description: Search terms. Use the distinctive nouns you are looking for (a place, a person, a faction) rather than a full sentence.
    required: true
config:
  folders:
    - context
  maxResults: 5
---

Search the established lore for facts about people, places, factions, and events.

Use this whenever you are about to name or describe something that already exists
in this world. Established facts beat invented ones — if the lore says a tavern is
owned by a particular person, that is who owns it, regardless of what would make a
tidier story.

Search before you write the detail, not after. If a search returns nothing, the
subject is genuinely unestablished and you may invent it freely.
