# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| --------------------------- | --------------------- | ----------------------------------------- |
| `needs-triage`               | `needs-triage`         | Maintainer needs to evaluate this issue    |
| `needs-info`                 | `needs-info`           | Waiting on reporter for more information   |
| `ready-for-agent`            | `ready-for-agent`      | Fully specified, ready for an AFK agent    |
| `ready-for-human`            | `ready-for-human`      | Requires human implementation              |
| `wontfix`                    | `wontfix`              | Will not be actioned                       |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Additional labels (effort / type)

Beyond the five canonical triage roles, this repo also uses:

| Label      | Meaning                                                   |
| ---------- | ---------------------------------------------------------- |
| `easy`     | Low-effort, quick to implement                             |
| `medium`   | Moderate effort                                             |
| `hard`     | High effort / complex                                       |
| `refactor` | Restructuring existing code, not new behavior               |
| `grilling` | Needs the `/grilling` stress-test pass before it's ready    |

These aren't part of the five-role state machine `triage` drives — apply them as supplementary classification, not a replacement for the canonical roles above.
