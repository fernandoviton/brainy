/**
 * Reads Claude subscription usage (5-hour session window + weekly window) the
 * same way Claude Code's /usage does: GET api/oauth/usage with the OAuth token
 * Claude Code keeps in ~/.claude/.credentials.json.
 *
 * The endpoint is undocumented and may change shape; normalizeUsage throws on
 * anything unexpected, and the scheduler treats a failed probe as "usage
 * unknown" (capacity jobs wait), so a change can only make jobs not run.
 *
 * We never refresh the OAuth token ourselves: the refresh token rotates, and
 * racing Claude Code for it could sign the machine out. Instead, when the
 * access token has expired, we run a trivial `claude -p` so Claude Code
 * refreshes it, then re-read the file.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json');
const EXPIRY_SKEW_MS = 60e3;

function toIso(t) {
  return new Date(t).toISOString();
}

function normalizeUsage(raw, now) {
  const s = raw && raw.five_hour;
  const w = raw && raw.seven_day;
  if (!s || !w || typeof s.utilization !== 'number' || typeof w.utilization !== 'number'
      || !s.resets_at || !w.resets_at) {
    throw new Error('unexpected usage response shape (missing five_hour/seven_day)');
  }
  return {
    fetched_at: now.toISOString(),
    session: { percent: s.utilization, resets_at: toIso(s.resets_at) },
    weekly: { percent: w.utilization, resets_at: toIso(w.resets_at) },
  };
}

function readOauth(credentialsPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read Claude credentials at ${credentialsPath}: ${err.message} — sign in with \`claude\` first`);
  }
  const o = parsed && parsed.claudeAiOauth;
  if (!o || !o.accessToken) throw new Error(`no claudeAiOauth token in ${credentialsPath}`);
  return o;
}

// Runs from the temp dir so no project's CLAUDE.md or session hooks load.
function defaultRefreshAuth(spawn = spawnSync) {
  spawn('claude', ['-p', 'Reply with OK', '--model', 'haiku'], {
    cwd: os.tmpdir(),
    stdio: 'ignore',
    timeout: 120e3,
  });
}

function createUsageProbe({
  credentialsPath = DEFAULT_CREDENTIALS,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  refreshAuth = defaultRefreshAuth,
} = {}) {
  return async function probeUsage() {
    let oauth = readOauth(credentialsPath);
    if (oauth.expiresAt && oauth.expiresAt - EXPIRY_SKEW_MS <= now().getTime()) {
      await refreshAuth();
      oauth = readOauth(credentialsPath);
      if (oauth.expiresAt && oauth.expiresAt - EXPIRY_SKEW_MS <= now().getTime()) {
        throw new Error('Claude OAuth token expired and Claude Code did not refresh it — run `claude` to sign in');
      }
    }
    const res = await fetchImpl(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });
    if (!res.ok) throw new Error(`usage endpoint returned HTTP ${res.status}`);
    return normalizeUsage(await res.json(), now());
  };
}

module.exports = { createUsageProbe, normalizeUsage, defaultRefreshAuth, USAGE_URL };
