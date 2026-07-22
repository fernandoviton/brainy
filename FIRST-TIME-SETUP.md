# First-Time Setup

Run once after cloning this repo (or after moving/re-cloning it to a new path).

```bash
npm install
python -m venv tools/.venv && tools/.venv/Scripts/pip install -r tools/requirements.txt
node scripts/setup-hooks.js
```

`scripts/setup-hooks.js` configures the `SessionStart`/`Stop` Claude Code hooks (promote
scheduled TODOs; check Supabase auth on stop — see `.claude/hooks/`). Their commands need an
absolute path to this checkout, which is machine-specific and can't live in the git-tracked
`.claude/settings.json` — the script writes it into the gitignored `.claude/settings.local.json`
instead, preserving anything else already there. It's idempotent and self-correcting, so re-run
it any time; `--check` reports status without writing (Claude runs this automatically at session
start, per `CLAUDE.md`).
