# First-Time Setup

Run once per machine after cloning this repo (or after moving/re-cloning it to a new path).
Works on Windows, macOS and Linux. This covers a new **checkout** of an existing Brainy
project. Creating the Supabase project itself (schema, Google provider, redirect URLs) is
in `README.md` and only happens once.

## 1. Install dependencies

```bash
npm install
```

PDF conversion (`tools/convert-capture-pdfs.js`) needs a Python venv with `marker-pdf`:

```bash
# Windows
python -m venv tools/.venv && tools/.venv/Scripts/pip install -r tools/requirements.txt

# Linux / macOS
python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt
```

(On Debian/Ubuntu, `python3 -m venv` needs the `python3-venv` package.)

## 2. Configure hooks

```bash
node scripts/setup-hooks.js
```

This configures the Claude Code hooks in `.claude/hooks/`:
- **SessionStart:** promote scheduled TODOs and run the throttled backup
- **Stop:** run integrity checks and flag an expired login

Each hook runs as `node "<absolute path>/.claude/hooks/<hook>.js"`, so the same command works
on every OS. The absolute path is machine-specific and can't live in the git-tracked
`.claude/settings.json`, so the script writes it into the gitignored
`.claude/settings.local.json`, preserving anything else already there. It's idempotent and
self-correcting, so re-run it any time (including after pulling a change to the hooks).
`--check` reports status without writing; Claude runs it automatically at session start,
per `CLAUDE.md`.

## 3. Authenticate (per machine)

The CLI signs in to Supabase as **you**, via Google. It needs three values in `.env`:

| Variable | What it is | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | Project URL | Supabase dashboard → Settings → API, or copy from another machine's `.env` |
| `SUPABASE_PUBLISHABLE_KEY` | Public client key | Same place. Safe to copy between machines |
| `SUPABASE_REFRESH_TOKEN` | This machine's login | Written by `scripts/google-login.js`. **Don't copy it** |

```bash
cp .env.example .env        # then fill in SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
node scripts/google-login.js
```

The login script starts a small server on `http://localhost:3000`, opens it in your browser
(and prints the URL in case no browser opens), sends you through Google sign-in, and writes
`SUPABASE_REFRESH_TOKEN` into `.env`. Then verify:

```bash
node backend/cli.js todo list
```

**Give each machine its own login.** The refresh token belongs to one login session. If you
copy it to a second machine, both share that session, and when it's revoked both stop
working at once. A separate `google-login.js` run on each machine keeps them independent.

### Signing in on a remote machine (VM, server)

The browser has to reach `localhost:3000` **on the machine running the script**, because Google
redirects back to `http://localhost:3000/auth/callback`. Use either:

- **The machine's desktop (e.g. VNC):** run the script from a terminal on that desktop, or with
  `DISPLAY` set to the desktop (e.g. `DISPLAY=:1 node scripts/google-login.js`). The browser
  opens there; sign in through the VNC viewer.
- **An SSH tunnel from your own computer:** connect with
  `ssh -L 3000:localhost:3000 <user>@<host>`, run `node scripts/google-login.js` in that
  session, and open `http://localhost:3000` in your **local** browser. The callback goes
  through the tunnel to the remote script.

Either way, the token is written to the **remote** machine's `.env`.

### When the login expires

The token doesn't expire on a timer. It stops working when the session is ended: a
global sign-out, revocation in the Supabase dashboard, or a session time limit if one is
configured there. You'll see `Invalid Refresh Token` from the CLI, and the Stop hook will
block with a reminder. To fix it, re-run the same script on that machine:

```bash
node scripts/google-login.js
```

(`scripts/refresh-token.js` is an alias for the same flow.)
