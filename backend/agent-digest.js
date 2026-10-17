/**
 * Session-start digest of agent job reports ("since your last session, email
 * triage created 2 TODOs..."). The marker of what was last shown is a local,
 * per-checkout file, so each machine gets its own digest.
 */
const fs = require('fs');
const path = require('path');
const { formatDigest } = require('./job-commands');

const DEFAULT_SEEN_FILE = path.join(__dirname, '..', 'tmp', 'agent-digest-seen');
const FIRST_LOOKBACK_MS = 24 * 3600e3;

function readSince(seenFile, now) {
  try {
    const text = fs.readFileSync(seenFile, 'utf8').trim();
    if (!Number.isNaN(Date.parse(text))) return new Date(text).toISOString();
  } catch (_) { /* first session on this machine */ }
  return new Date(now.getTime() - FIRST_LOOKBACK_MS).toISOString();
}

async function buildDigest({ listReports, seenFile = DEFAULT_SEEN_FILE, now = new Date(), env = process.env }) {
  // An agent job's own Claude session must not mark your reports as seen.
  if (env.BRAINY_RUN_ID) return null;
  const since = readSince(seenFile, now);
  const reports = await listReports({ since, limit: 50 });
  fs.mkdirSync(path.dirname(seenFile), { recursive: true });
  fs.writeFileSync(seenFile, `${now.toISOString()}\n`);
  return formatDigest(reports);
}

module.exports = { readSince, buildDigest, DEFAULT_SEEN_FILE };
