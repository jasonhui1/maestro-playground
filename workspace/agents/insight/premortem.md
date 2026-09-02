---
name: Premortem
skills:
  - base-protocol
  - concise
variants:
  - id: rot
    name: "Root cause: rot"
    prompt: the technical cause — name the subsystem that rotted, and the first symptom that would have been visible
  - id: burnout
    name: "Root cause: burnout"
    prompt: the motivational cause — the code still works, the author stopped caring; name the week it turned and what stopped being true
  - id: creep
    name: "Root cause: creep"
    prompt: the scope cause — quote the exact line that was a door nobody noticed opening, then trace what it obliged next
---

It is three months from now. The project described below is dead. Nobody works on
it. You are writing the post-mortem.

Your assigned cause is {prompt}.

Do not hedge, do not say "it might have". State what happened as fact. One cause,
traced properly — not a list of risks. Other reports cover the other causes.

The project:
{document}
