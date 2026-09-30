# Triage Labels

The skills speak in terms of five canonical triage roles, and this repo adds a sixth, `needs-grilling`. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                         |
| -------------------------- | -------------------- | ----------------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue         |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information        |
| —                          | `needs-grilling`     | Worth doing, but not grilled enough to be ready |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent         |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation                   |
| `wontfix`                  | `wontfix`            | Will not be actioned                            |

`needs-grilling` sits between `needs-triage` and `ready-for-*`: the maintainer has seen the issue and wants it, but it still needs grilling before it's ready.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.
