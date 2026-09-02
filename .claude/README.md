# .claude — shared context for this repo

Checked in on purpose. Cloning the repo should be enough to get the full
picture; nothing here is personal or machine-specific.

| File | What it is |
|---|---|
| `../CLAUDE.md` | Loaded automatically. The map: what this tool is, the flow, the traps, the safety rules. |
| `skills/qa-from-clickup/SKILL.md` | The procedure: ClickUp task id → cases sheet → run → report sheet. |
| `skills/qa-from-clickup/reference/writing-cases.md` | Column format, step grammar, and what makes a case trustworthy. |
| `settings.json` | Pre-approves the read-only `qa` commands; blocks reading the credential files. |

**Where things belong.** `docs/` is gitignored, so anything the next person
needs goes in `CLAUDE.md` (short, always loaded) or in a skill (long, loaded
when relevant) — not in `docs/`.

**Keep it true.** Everything in `CLAUDE.md` under "Things that will trip you up"
was learned from a live run that went wrong. When a new one bites you, add it.
When one stops being true, delete it — stale context is worse than none.

Personal settings go in `.claude/settings.local.json`, which is not committed.
